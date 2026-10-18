use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account as SplAccount, AccountState, Mint as SplMint},
};

// Local test identity only. No keypair, mainnet deployment or funding address is assigned.
declare_id!("Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k");
pub const OFFICIAL_MINT: Pubkey = pubkey!("HKrTVBPVF9B8LEkNvZDm4PeNScnvoHv8JxNMTahVpump");
pub const FEE_WALLET: Pubkey = pubkey!("4Efsdp2PYBseESD4oqFfe2Sm4D9Tq6fbTVm4KztxiHVz");
pub const MIN_CLAIM: u64 = 100_000_000_000;
pub const MIN_HOLDING: u64 = 2_500_000_000;
pub const CLAIM_STUDIO_LAMPORTS: u64 = 2_500_000;
pub const FIRST_CLAIM_AGE_SECONDS: i64 = 7 * 86_400;
pub const MAX_CLAIM_TTL_SECONDS: i64 = 120;
pub const TOKEN_DECIMALS: u8 = 6;

#[program]
pub mod heatwave_protected_reserve {
    use super::*;

    /// Creates isolated custody. The backend key and limits have no update instruction.
    /// There is no direct administrator withdrawal instruction. Gameplay earnings are
    /// trusted to the backend, which can authorize fabricated claims to controlled players.
    pub fn initialize(
        ctx: Context<Initialize>, reserve_id: [u8; 16], game_verifier: Pubkey,
        max_claim_gross: u64, player_daily_cap: u64,
        global_daily_cap: u64, lifetime_cap: u64, safety_reserve: u64,
    ) -> Result<()> {
        require!(ctx.remaining_accounts.is_empty(), ReserveError::UnexpectedAccounts);
        validate_mint(&ctx.accounts.mint.to_account_info())?;
        let creator = ctx.accounts.creator.key();
        require_keys_eq!(game_verifier, ctx.accounts.game_verifier_signer.key(), ReserveError::InvalidVerifier);
        require!(game_verifier != Pubkey::default(), ReserveError::InvalidVerifier);
        require!(game_verifier.is_on_curve(), ReserveError::InvalidVerifier);
        require!(game_verifier != creator && game_verifier != FEE_WALLET, ReserveError::RoleCollision);
        require!(max_claim_gross >= MIN_CLAIM && player_daily_cap >= max_claim_gross
            && global_daily_cap >= player_daily_cap && lifetime_cap >= global_daily_cap,
            ReserveError::InvalidLimits);
        require!(safety_reserve.checked_add(max_claim_gross).is_some(), ReserveError::Arithmetic);
        let now = valid_time()?;
        ctx.accounts.config.set_inner(ReserveConfig {
            creator, reserve_id, game_verifier,
            max_claim_gross, player_daily_cap, global_daily_cap, lifetime_cap, safety_reserve,
            current_day: now / 86_400, daily_spent: 0, lifetime_spent: 0,
            bump: ctx.bumps.config, authority_bump: ctx.bumps.authority,
        });
        Ok(())
    }

    /// Registration is on-chain; a browser timestamp cannot backdate the seven-day gate.
    pub fn register_player(ctx: Context<RegisterPlayer>) -> Result<()> {
        require!(ctx.remaining_accounts.is_empty(), ReserveError::UnexpectedAccounts);
        validate_player_role(ctx.accounts.player.key(), &ctx.accounts.config)?;
        let now = valid_time()?;
        ctx.accounts.player_state.set_inner(PlayerState {
            config: ctx.accounts.config.key(), wallet: ctx.accounts.player.key(),
            registered_at: now, current_day: now / 86_400, daily_spent: 0,
            lifetime_spent: 0, claim_count: 0, bump: ctx.bumps.player_state,
        });
        Ok(())
    }

    /// The player and backend game verifier sign these exact terms together.
    /// No human reviewer is required. The program checks settlement limits and fixed
    /// recipients; it cannot independently prove the backend's gameplay earnings.
    pub fn claim(ctx: Context<Claim>, claim_id: [u8; 32], gross: u64, expires_at: i64) -> Result<()> {
        require!(ctx.remaining_accounts.is_empty(), ReserveError::UnexpectedAccounts);
        let now = valid_time()?;
        require!(expires_at > now && expires_at <= now.checked_add(MAX_CLAIM_TTL_SECONDS)
            .ok_or(ReserveError::Arithmetic)?, ReserveError::Expired);
        validate_player_role(ctx.accounts.player.key(), &ctx.accounts.config)?;
        validate_mint(&ctx.accounts.mint.to_account_info())?;
        validate_token_account(&ctx.accounts.reserve.to_account_info(), true)?;
        validate_token_account(&ctx.accounts.player_tokens.to_account_info(), false)?;
        validate_token_account(&ctx.accounts.fee_tokens.to_account_info(), false)?;
        let state = &ctx.accounts.player_state;
        require!(state.registered_at <= now, ReserveError::InvalidClock);
        if state.claim_count == 0 {
            require!(now.checked_sub(state.registered_at).ok_or(ReserveError::Arithmetic)?
                >= FIRST_CLAIM_AGE_SECONDS, ReserveError::AccountTooNew);
        }
        // Must be checked before any payout; the incoming reward does not satisfy it.
        require!(ctx.accounts.player_tokens.amount >= MIN_HOLDING, ReserveError::HoldingRequired);
        let config = &ctx.accounts.config;
        let allocation = split_claim(gross)?;
        require!(gross <= config.max_claim_gross, ReserveError::LimitExceeded);
        require!(ctx.accounts.reserve.amount >= gross.checked_add(config.safety_reserve)
            .ok_or(ReserveError::Arithmetic)?, ReserveError::BackingRequired);
        let day = now / 86_400;
        let global_daily = next_daily(config.current_day, config.daily_spent, day, gross, config.global_daily_cap)?;
        let player_daily = next_daily(state.current_day, state.daily_spent, day, gross, config.player_daily_cap)?;
        let total = config.lifetime_spent.checked_add(gross).ok_or(ReserveError::Arithmetic)?;
        require!(total <= config.lifetime_cap, ReserveError::LimitExceeded);
        let player_total = state.lifetime_spent.checked_add(gross).ok_or(ReserveError::Arithmetic)?;
        let claim_count = state.claim_count.checked_add(1).ok_or(ReserveError::Arithmetic)?;

        let config_key = config.key();
        let authority_bump = [config.authority_bump];
        let seeds: &[&[u8]] = &[b"authority", config_key.as_ref(), &authority_bump];
        let signers = &[seeds];
        let transfer_player = TransferChecked {
            from: ctx.accounts.reserve.to_account_info(), mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.player_tokens.to_account_info(), authority: ctx.accounts.authority.to_account_info(),
        };
        token_interface::transfer_checked(CpiContext::new(ctx.accounts.token_program.key(), transfer_player)
            .with_signer(signers), allocation.net, TOKEN_DECIMALS)?;
        let transfer_fee = TransferChecked {
            from: ctx.accounts.reserve.to_account_info(), mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.fee_tokens.to_account_info(), authority: ctx.accounts.authority.to_account_info(),
        };
        token_interface::transfer_checked(CpiContext::new(ctx.accounts.token_program.key(), transfer_fee)
            .with_signer(signers), allocation.fee, TOKEN_DECIMALS)?;
        system_program::transfer(CpiContext::new(system_program::ID, Transfer {
            from: ctx.accounts.player.to_account_info(), to: ctx.accounts.fee_wallet.to_account_info(),
        }), CLAIM_STUDIO_LAMPORTS)?;

        // Any failure above rolls back both token legs, SOL, receipt initialization and rent.
        let config = &mut ctx.accounts.config;
        config.current_day = day; config.daily_spent = global_daily; config.lifetime_spent = total;
        let state = &mut ctx.accounts.player_state;
        state.current_day = day; state.daily_spent = player_daily;
        state.lifetime_spent = player_total; state.claim_count = claim_count;
        ctx.accounts.claim_receipt.set_inner(ClaimReceipt {
            config: config_key, player: ctx.accounts.player.key(), claim_id,
            gross, fee: allocation.fee, settled_at: now, expires_at, bump: ctx.bumps.claim_receipt,
        });
        emit!(ClaimSettled { config: config_key, player: ctx.accounts.player.key(), claim_id,
            gross, net: allocation.net, fee: allocation.fee, studio_lamports: CLAIM_STUDIO_LAMPORTS });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(reserve_id: [u8; 16])]
pub struct Initialize<'info> {
    #[account(mut, owner = system_program::ID)]
    pub creator: Signer<'info>,
    pub game_verifier_signer: Signer<'info>,
    #[account(init, payer = creator, space = 8 + ReserveConfig::INIT_SPACE,
        seeds = [b"htw_reserve", creator.key().as_ref(), &reserve_id], bump)]
    pub config: Account<'info, ReserveConfig>,
    /// CHECK: canonical PDA is only a token authority; no writable arbitrary account.
    #[account(seeds = [b"authority", config.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(address = OFFICIAL_MINT, owner = token_2022::ID)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = creator, associated_token::mint = mint,
        associated_token::authority = authority, associated_token::token_program = token_program)]
    pub reserve: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    #[account(mut, owner = system_program::ID)]
    pub player: Signer<'info>,
    #[account(seeds = [b"htw_reserve", config.creator.as_ref(), &config.reserve_id], bump = config.bump)]
    pub config: Account<'info, ReserveConfig>,
    #[account(init, payer = player, space = 8 + PlayerState::INIT_SPACE,
        seeds = [b"player", config.key().as_ref(), player.key().as_ref()], bump)]
    pub player_state: Account<'info, PlayerState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct Claim<'info> {
    #[account(mut, owner = system_program::ID)]
    pub player: Signer<'info>,
    #[account(address = config.game_verifier)]
    pub game_verifier: Signer<'info>,
    #[account(mut, seeds = [b"htw_reserve", config.creator.as_ref(), &config.reserve_id], bump = config.bump)]
    pub config: Account<'info, ReserveConfig>,
    /// CHECK: exact canonical PDA signs fixed token CPIs only.
    #[account(seeds = [b"authority", config.key().as_ref()], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"player", config.key().as_ref(), player.key().as_ref()], bump = player_state.bump,
        has_one = config, constraint = player_state.wallet == player.key())]
    pub player_state: Account<'info, PlayerState>,
    #[account(init, payer = player, space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [b"claim", config.key().as_ref(), player.key().as_ref(), &claim_id], bump)]
    pub claim_receipt: Account<'info, ClaimReceipt>,
    #[account(address = OFFICIAL_MINT, owner = token_2022::ID)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, owner = token_2022::ID, associated_token::mint = mint,
        associated_token::authority = authority, associated_token::token_program = token_program)]
    pub reserve: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, owner = token_2022::ID, associated_token::mint = mint,
        associated_token::authority = player, associated_token::token_program = token_program)]
    pub player_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, owner = token_2022::ID, associated_token::mint = mint,
        associated_token::authority = fee_wallet, associated_token::token_program = token_program)]
    pub fee_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = FEE_WALLET)]
    pub fee_wallet: SystemAccount<'info>,
    #[account(address = token_2022::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ReserveConfig {
    pub creator: Pubkey, pub reserve_id: [u8; 16],
    pub game_verifier: Pubkey,
    pub max_claim_gross: u64, pub player_daily_cap: u64, pub global_daily_cap: u64,
    pub lifetime_cap: u64, pub safety_reserve: u64,
    pub current_day: i64, pub daily_spent: u64, pub lifetime_spent: u64,
    pub bump: u8, pub authority_bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub config: Pubkey, pub wallet: Pubkey, pub registered_at: i64,
    pub current_day: i64, pub daily_spent: u64, pub lifetime_spent: u64,
    pub claim_count: u64, pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub config: Pubkey, pub player: Pubkey, pub claim_id: [u8; 32],
    pub gross: u64, pub fee: u64, pub settled_at: i64, pub expires_at: i64, pub bump: u8,
}
#[event]
pub struct ClaimSettled {
    pub config: Pubkey, pub player: Pubkey, pub claim_id: [u8; 32],
    pub gross: u64, pub net: u64, pub fee: u64, pub studio_lamports: u64,
}

pub struct Allocation { pub net: u64, pub fee: u64 }
pub fn split_claim(gross: u64) -> Result<Allocation> {
    require!(gross >= MIN_CLAIM, ReserveError::MinimumClaim);
    let fee = ((gross as u128) * 300 / 10_000) as u64;
    Ok(Allocation { fee, net: gross.checked_sub(fee).ok_or(ReserveError::Arithmetic)? })
}
pub fn next_daily(previous_day: i64, spent: u64, day: i64, gross: u64, cap: u64) -> Result<u64> {
    require!(day >= 0 && previous_day >= 0 && day >= previous_day, ReserveError::InvalidClock);
    let next = (if day == previous_day { spent } else { 0 }).checked_add(gross).ok_or(ReserveError::Arithmetic)?;
    require!(next <= cap, ReserveError::LimitExceeded);
    Ok(next)
}
fn valid_time() -> Result<i64> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ReserveError::InvalidClock);
    Ok(now)
}
fn validate_player_role(wallet: Pubkey, config: &ReserveConfig) -> Result<()> {
    require!(wallet != FEE_WALLET && wallet != config.game_verifier,
        ReserveError::RoleCollision);
    Ok(())
}
fn validate_mint(info: &AccountInfo) -> Result<()> {
    require_keys_eq!(*info.owner, token_2022::ID, ReserveError::InvalidTokenState);
    let bytes = info.try_borrow_data()?;
    let mint = StateWithExtensions::<SplMint>::unpack(&bytes)?;
    require!(mint.base.decimals == TOKEN_DECIMALS && mint.base.mint_authority.is_none()
        && mint.base.freeze_authority.is_none(), ReserveError::InvalidTokenState);
    for extension in mint.get_extension_types()? {
        require!(matches!(extension, ExtensionType::MetadataPointer | ExtensionType::TokenMetadata),
            ReserveError::UnsupportedExtension);
    }
    Ok(())
}
fn validate_token_account(info: &AccountInfo, reserve: bool) -> Result<()> {
    let bytes = info.try_borrow_data()?;
    let state = StateWithExtensions::<SplAccount>::unpack(&bytes)?;
    require!(state.base.state == AccountState::Initialized && state.base.is_native.is_none(), ReserveError::InvalidTokenState);
    for extension in state.get_extension_types()? {
        require!(matches!(extension, ExtensionType::ImmutableOwner), ReserveError::UnsupportedExtension);
    }
    if reserve {
        require!(state.base.delegate.is_none() && state.base.delegated_amount == 0
            && state.base.close_authority.is_none(), ReserveError::ReserveAuthorityChanged);
    }
    Ok(())
}

#[error_code]
pub enum ReserveError {
    #[msg("Unexpected remaining accounts")] UnexpectedAccounts,
    #[msg("Verifier must be an assigned signable public key")] InvalidVerifier,
    #[msg("Signing and revenue roles must be distinct")] RoleCollision,
    #[msg("Limits must cover at least the minimum claim and be coherent")] InvalidLimits,
    #[msg("Checked arithmetic failed")] Arithmetic,
    #[msg("Clock or daily bucket regressed")] InvalidClock,
    #[msg("Claim expiry must be future and no more than 120 seconds away")] Expired,
    #[msg("First claim requires seven days of on-chain registration")] AccountTooNew,
    #[msg("Wallet must already hold at least 2500 HTW")] HoldingRequired,
    #[msg("Claim exposure limit exceeded")] LimitExceeded,
    #[msg("Reserve must cover gross claim plus safety reserve")] BackingRequired,
    #[msg("Minimum gross claim is 100000 HTW")] MinimumClaim,
    #[msg("Unsupported token-account or mint state")] InvalidTokenState,
    #[msg("Unsupported Token-2022 extension")] UnsupportedExtension,
    #[msg("Reserve delegate or close authority is forbidden")] ReserveAuthorityChanged,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gross_allocation_including_u64_boundary() {
        for gross in [MIN_CLAIM, MIN_CLAIM + 1, 9_007_199_254_740_993, u64::MAX] {
            let split = split_claim(gross).unwrap();
            assert_eq!(split.net.checked_add(split.fee), Some(gross));
            assert_eq!(split.fee as u128, gross as u128 * 300 / 10_000);
        }
        assert_eq!(split_claim(MIN_CLAIM).unwrap().net, 97_000_000_000);
        assert!(split_claim(MIN_CLAIM - 1).is_err());
    }
    #[test]
    fn daily_caps_reset_without_overflow_or_clock_regression() {
        assert_eq!(next_daily(10, MIN_CLAIM, 10, MIN_CLAIM, MIN_CLAIM * 2).unwrap(), MIN_CLAIM * 2);
        assert!(next_daily(10, MIN_CLAIM, 10, MIN_CLAIM, MIN_CLAIM * 2 - 1).is_err());
        assert_eq!(next_daily(10, u64::MAX, 11, MIN_CLAIM, MIN_CLAIM).unwrap(), MIN_CLAIM);
        assert!(next_daily(10, u64::MAX, 10, 1, u64::MAX).is_err());
        assert!(next_daily(10, 0, 9, MIN_CLAIM, u64::MAX).is_err());
    }
    #[test]
    fn account_layouts_are_fixed_for_client_and_fixtures() {
        assert_eq!(ReserveConfig::INIT_SPACE, 146);
        assert_eq!(PlayerState::INIT_SPACE, 105);
        assert_eq!(ClaimReceipt::INIT_SPACE, 129);
    }
}
