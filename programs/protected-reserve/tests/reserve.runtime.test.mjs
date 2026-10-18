import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
 AccountRole,address,appendTransactionMessageInstructions,createTransactionMessage,
 generateKeyPairSigner,getAddressEncoder,getProgramDerivedAddress,lamports,
 setTransactionMessageFeePayerSigner,signTransactionMessageWithSigners,
} from '@solana/kit';
import {
 ASSOCIATED_TOKEN_PROGRAM_ADDRESS,TOKEN_2022_PROGRAM_ADDRESS,AccountState,
 getCreateAssociatedTokenIdempotentInstruction,getMintEncoder,getTokenEncoder,getTokenDecoder,
 getTransferCheckedInstruction,
} from '@solana-program/token-2022';
import {getTransferSolInstruction} from '@solana-program/system';
import {LiteSVM,FailedTransactionMetadata} from 'litesvm';

// All signers are fresh, ephemeral local SVM identities. This suite has no RPC,
// wallet connector, deployment transaction, real funding or persisted keypairs.
const PROGRAM=address('Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k');
const MINT=address('HKrTVBPVF9B8LEkNvZDm4PeNScnvoHv8JxNMTahVpump');
const FEE=address('4Efsdp2PYBseESD4oqFfe2Sm4D9Tq6fbTVm4KztxiHVz');
const SYSTEM=address('11111111111111111111111111111111');
const TOKEN=TOKEN_2022_PROGRAM_ADDRESS,ATA=ASSOCIATED_TOKEN_PROGRAM_ADDRESS;
const GROSS=100_000_000_000n,HOLDING=2_500_000_000n,STUDIO=2_500_000n;
const NOW=1_800_000_000n,AGE=604_800n;
const artifact=process.env.HTW_RESERVE_SBF??fileURLToPath(new URL('../target/automatic-v2-deploy/heatwave_protected_reserve.so',import.meta.url));
// Missing artifacts fail the suite; source/model-only tests must never substitute
// for executing the compiled program and its real Token-2022/System CPIs.
const programBytes=new Uint8Array(readFileSync(artifact));
assert.deepEqual([...programBytes.subarray(0,4)],[127,69,76,70],'compiled SBF ELF artifact required');
console.log(`SBF artifact SHA256 ${createHash('sha256').update(programBytes).digest('hex')}`);
const addressBytes=value=>getAddressEncoder().encode(value);
const text=value=>new TextEncoder().encode(value);
const disc=(namespace,name)=>createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0,8);
const u64=value=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(value));return bytes;};
const i64=value=>{const bytes=Buffer.alloc(8);bytes.writeBigInt64LE(BigInt(value));return bytes;};
const meta=(value,writable=false)=>typeof value==='string'
 ?{address:value,role:writable?AccountRole.WRITABLE:AccountRole.READONLY}
 :{address:value.address,role:writable?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER,signer:value};
const instruction=(name,accounts,...args)=>({programAddress:PROGRAM,accounts,data:Buffer.concat([disc('global',name),...args])});
const derive=(programAddress,seeds)=>getProgramDerivedAddress({programAddress,seeds});
const ata=owner=>derive(ATA,[addressBytes(owner),addressBytes(TOKEN),addressBytes(MINT)]).then(([pubkey])=>pubkey);
function setClock(svm,unixTimestamp){const clock=svm.getClock();clock.unixTimestamp=unixTimestamp;svm.setClock(clock);}
function fixtureAccount(svm,pubkey,owner,data){svm.setAccount({address:pubkey,programAddress:owner,lamports:svm.minimumBalanceForRentExemption(BigInt(data.length)),data,space:BigInt(data.length),executable:false});}
function mintFixture(svm,pubkey=MINT,extensions=null){
 // Canonical local mint fixture: six decimals, fixed supply, revoked authorities.
 // It occupies the official address only inside this disposable SVM.
 const bytes=getMintEncoder().encode({mintAuthority:null,supply:1_000_000_000_000_000n,decimals:6,isInitialized:true,freezeAuthority:null,extensions});
 fixtureAccount(svm,pubkey,TOKEN,bytes);
}
async function signed(svm,payer,instructions){
 let message=createTransactionMessage({version:0});
 message=setTransactionMessageFeePayerSigner(payer,message);
 message=appendTransactionMessageInstructions(instructions,message);
 message=svm.setTransactionMessageLifetimeUsingLatestBlockhash(message);
 return signTransactionMessageWithSigners(message);
}
async function send(f,instructions,{payer=f.creator,success=true,error}={}){
 f.svm.expireBlockhash();
 const transaction=await signed(f.svm,payer,instructions);
 const result=f.svm.sendTransaction(transaction);
 const failed=result instanceof FailedTransactionMetadata;
 const logs=failed?result.meta().logs():result.logs();
 if(success)assert.equal(failed,false,`transaction failed: ${failed?result.err():''}\n${logs.join('\n')}`);
 else{assert.equal(failed,true,'transaction unexpectedly succeeded');if(error)assert.match(logs.join('\n'),error);}
 return {result,logs,transaction};
}
function tokenAmount(f,pubkey){const account=f.svm.getAccount(pubkey);assert.ok(account.exists,`token account ${pubkey} required`);return getTokenDecoder().decode(account.data).amount;}
function accountData(f,pubkey){const account=f.svm.getAccount(pubkey);return account.exists?Buffer.from(account.data).toString('hex'):null;}
function balances(f){return {reserve:tokenAmount(f,f.reserve),player:tokenAmount(f,f.playerAta),fee:tokenAmount(f,f.feeAta),playerSol:f.svm.getBalance(f.player.address),feeSol:f.svm.getBalance(FEE),config:accountData(f,f.config),playerState:accountData(f,f.playerState)};}
function initializeInstruction(f,{gameAccount=f.game,gameKey=f.game.address}={}){
 const cap=f.cap;
 return instruction('initialize',[meta(f.creator,true),meta(gameAccount),meta(f.config,true),meta(f.authority),meta(MINT),meta(f.reserve,true),meta(TOKEN),meta(ATA),meta(SYSTEM)],f.reserveId,addressBytes(gameKey),u64(cap.max),u64(cap.player),u64(cap.global),u64(cap.lifetime),u64(cap.safety));
}
async function setup({holding=HOLDING,funding=1_000_000_000_000n,sourceFunding=10_000_000_000_000n,mature=true,limits={},mintExtensions=null}={}){
 const [creator,game,player,attacker]=await Promise.all(Array.from({length:4},()=>generateKeyPairSigner()));
 const svm=new LiteSVM(); // Signature verification and runtime checks stay enabled.
 svm.addProgram(PROGRAM,programBytes);
 setClock(svm,NOW);
 for(const signer of [creator,game,player,attacker])svm.airdrop(signer.address,lamports(20_000_000_000n));
 svm.airdrop(FEE,lamports(1_000_000n));
 mintFixture(svm,MINT,mintExtensions);
 const reserveId=randomBytes(16);
 const [config]=await derive(PROGRAM,[text('htw_reserve'),addressBytes(creator.address),reserveId]);
 const [authority]=await derive(PROGRAM,[text('authority'),addressBytes(config)]);
 const [playerState]=await derive(PROGRAM,[text('player'),addressBytes(config),addressBytes(player.address)]);
 const [reserve,playerAta,feeAta,creatorAta]=await Promise.all([ata(authority),ata(player.address),ata(FEE),ata(creator.address)]);
 const cap={max:GROSS*2n,player:GROSS*2n,global:GROSS*3n,lifetime:GROSS*5n,safety:GROSS/4n,...limits};
 const f={svm,creator,game,player,attacker,reserveId,config,authority,playerState,reserve,playerAta,feeAta,creatorAta,cap};
 await send(f,[initializeInstruction(f)]);
 fixtureAccount(svm,creatorAta,TOKEN,getTokenEncoder().encode({mint:MINT,owner:creator.address,amount:sourceFunding,delegate:null,state:AccountState.Initialized,isNative:null,delegatedAmount:0n,closeAuthority:null,extensions:null}));
 await send(f,[getCreateAssociatedTokenIdempotentInstruction({payer:creator,ata:playerAta,owner:player.address,mint:MINT}),getCreateAssociatedTokenIdempotentInstruction({payer:creator,ata:feeAta,owner:FEE,mint:MINT})]);
 const transfers=[getTransferCheckedInstruction({source:creatorAta,mint:MINT,destination:reserve,authority:creator,amount:funding,decimals:6})];
 if(holding>0n)transfers.push(getTransferCheckedInstruction({source:creatorAta,mint:MINT,destination:playerAta,authority:creator,amount:holding,decimals:6}));
 await send(f,transfers);
 await send(f,[instruction('register_player',[meta(player,true),meta(config),meta(playerState,true),meta(SYSTEM)])]);
 if(mature)setClock(svm,NOW+AGE);
 return f;
}
async function claim(f,{claimId=randomBytes(32),gross=GROSS,expiresAt=f.svm.getClock().unixTimestamp+60n,game=f.game,playerTokens=f.playerAta,mint=MINT,feeWallet=FEE,feeTokens=f.feeAta,reserve=f.reserve,remaining=[]}={}){
 const [receipt]=await derive(PROGRAM,[text('claim'),addressBytes(f.config),addressBytes(f.player.address),claimId]);
 const ix=instruction('claim',[meta(f.player,true),meta(game),meta(f.config,true),meta(f.authority),meta(f.playerState,true),meta(receipt,true),meta(mint),meta(reserve,true),meta(playerTokens,true),meta(feeTokens,true),meta(feeWallet,true),meta(TOKEN),meta(SYSTEM),...remaining],claimId,u64(gross),i64(expiresAt));
 return {ix,receipt,claimId};
}
async function anotherPlayer(f){
 const player=await generateKeyPairSigner();f.svm.airdrop(player.address,lamports(20_000_000_000n));
 const playerAta=await ata(player.address),[playerState]=await derive(PROGRAM,[text('player'),addressBytes(f.config),addressBytes(player.address)]);
 await send(f,[getCreateAssociatedTokenIdempotentInstruction({payer:f.creator,ata:playerAta,owner:player.address,mint:MINT}),getTransferCheckedInstruction({source:f.creatorAta,mint:MINT,destination:playerAta,authority:f.creator,amount:HOLDING,decimals:6})]);
 await send(f,[instruction('register_player',[meta(player,true),meta(f.config),meta(playerState,true),meta(SYSTEM)])]);
 return {...f,player,playerAta,playerState};
}
async function rejectedClaim(f,terms,pattern){
 const before=balances(f),{ix,receipt}=await claim(f,terms);
 const outcome=await send(f,[ix],{success:false,error:pattern});
 assert.deepEqual(balances(f),before,'failed claim must roll back token legs, studio fee, receipt rent and accounting');
 assert.equal(f.svm.getAccount(receipt).exists,false,'failed claim must not consume claim ID');
 return outcome;
}

test('compiled SBF initializes canonical Token-2022 custody and registers players on-chain',async()=>{
 const f=await setup({mature:false});
 const reserve=f.svm.getAccount(f.reserve),decoded=getTokenDecoder().decode(reserve.data);
 assert.equal(reserve.programAddress,TOKEN);assert.equal(decoded.owner,f.authority);assert.equal(decoded.mint,MINT);
 assert.equal(decoded.delegate.__option,'None');assert.equal(decoded.closeAuthority.__option,'None');
 assert.equal(f.svm.getAccount(f.config).data.length,154);assert.equal(f.svm.getAccount(f.playerState).data.length,113);
 assert.equal(tokenAmount(f,f.reserve),1_000_000_000_000n);
});
test('initialization requires the game verifier signature and its exact matching public key',async()=>{
 const f=await setup();
 for(const overrides of [{gameAccount:f.game.address},{gameKey:f.attacker.address}]){
  const reserveId=randomBytes(16),[config]=await derive(PROGRAM,[text('htw_reserve'),addressBytes(f.creator.address),reserveId]);
  const [authority]=await derive(PROGRAM,[text('authority'),addressBytes(config)]),reserve=await ata(authority);
  await send(f,[initializeInstruction({...f,reserveId,config,authority,reserve},overrides)],{success:false,error:/AccountNotSigner|InvalidVerifier|RequireKeysEqViolated|ConstraintAddress/});
  assert.equal(f.svm.getAccount(config).exists,false);assert.equal(f.svm.getAccount(reserve).exists,false);
 }
});
test('automatic backend-authorized claim needs only player and game signatures and pays 97/3 plus SOL without human review',async()=>{
 const f=await setup(),before=balances(f),{ix,receipt}=await claim(f);
 const {result,logs,transaction}=await send(f,[ix],{payer:f.player});
 const after=balances(f),receiptAccount=f.svm.getAccount(receipt);
 assert.equal(before.reserve-after.reserve,GROSS);assert.equal(after.player-before.player,97_000_000_000n);assert.equal(after.fee-before.fee,3_000_000_000n);
 assert.deepEqual(Object.keys(transaction.signatures).sort(),[f.player.address,f.game.address].sort(),'no administrator or human reviewer signature participates in the automatic claim');
 assert.equal(after.feeSol-before.feeSol,STUDIO);
 assert.equal(before.playerSol-after.playerSol,STUDIO+receiptAccount.lamports+10_000n,'separate standard LiteSVM network fee for two transaction signatures');
 assert.equal(receiptAccount.programAddress,PROGRAM);assert.equal(receiptAccount.data.length,137);
 assert.ok(logs.filter(line=>line.includes('Instruction: TransferChecked')).length>=2,'real Token-2022 CPIs must execute');
 assert.ok(result.computeUnitsConsumed()>0n);
});
test('supported MetadataPointer and TokenMetadata mint extensions permit real claims',async()=>{
 const f=await setup({mintExtensions:[
  {__kind:'MetadataPointer',authority:null,metadataAddress:MINT},
  {__kind:'TokenMetadata',updateAuthority:null,mint:MINT,name:'HeatWave',symbol:'HTW',uri:'https://arcsova.xyz/htw.json',additionalMetadata:new Map()},
 ]});
 const before=balances(f),{ix}=await claim(f);await send(f,[ix]);
 assert.equal(before.reserve-tokenAmount(f,f.reserve),GROSS);assert.equal(tokenAmount(f,f.feeAta)-before.fee,3_000_000_000n);
});
test('registered account cannot claim before seven days, including one second before the boundary',async()=>{
 const f=await setup({mature:false});
 await rejectedClaim(f,{},/AccountTooNew/);
 setClock(f.svm,NOW+AGE-1n);await rejectedClaim(f,{},/AccountTooNew/);
 setClock(f.svm,NOW+AGE);const {ix}=await claim(f);await send(f,[ix]);
});
test('wallet holding is checked before payout and cannot be supplied by incoming rewards',async()=>{
 const f=await setup({holding:HOLDING-1n});await rejectedClaim(f,{},/HoldingRequired/);
});
test('missing game verifier signature or replacing the configured game verifier rejects without charging fees',async()=>{
 const f=await setup();
 for(const terms of [{game:f.game.address},{game:f.attacker}])await rejectedClaim(f,terms,/AccountNotSigner|ConstraintAddress/);
});
test('changing signed claim terms invalidates cryptographic transaction signatures',async()=>{
 const f=await setup(),before=balances(f),{ix,receipt}=await claim(f);
 f.svm.expireBlockhash();const original=await signed(f.svm,f.creator,[ix]);
 const changed=Uint8Array.from(original.messageBytes),offset=Buffer.from(changed).indexOf(ix.data);
 assert.ok(offset>=0,'claim data must occur in the serialized signed message');
 // Change one gross-amount byte, preserving the valid transaction/message shape.
 // Mutating lookup-table vector lengths would test malformed wire deserialization.
 changed[offset+8+32]^=1;
 const result=f.svm.sendTransaction({...original,messageBytes:changed});
 assert.ok(result instanceof FailedTransactionMetadata);
 // Pinned LiteSVM TransactionErrorFieldless::SignatureFailure is returned as 11.
 assert.equal(result.err(),11);assert.deepEqual(result.meta().logs(),[]);
 assert.deepEqual(balances(f),before);assert.equal(f.svm.getAccount(receipt).exists,false);
});
test('expired, overlong and below-minimum claims reject without consuming receipts or charging',async()=>{
 const f=await setup(),now=f.svm.getClock().unixTimestamp;
 await rejectedClaim(f,{expiresAt:now},/Expired/);await rejectedClaim(f,{expiresAt:now+121n},/Expired/);await rejectedClaim(f,{gross:GROSS-1n},/MinimumClaim/);
});
test('a settled claim ID cannot be replayed even with a new transaction blockhash',async()=>{
 const f=await setup(),claimId=randomBytes(32),{ix,receipt}=await claim(f,{claimId});await send(f,[ix]);
 const before=balances(f),receiptBefore=accountData(f,receipt);
 await send(f,[ix],{success:false});assert.deepEqual(balances(f),before);assert.equal(accountData(f,receipt),receiptBefore);
});
test('insufficient SOL after both token CPIs rolls back all payouts, accounting and receipt rent',async()=>{
 const f=await setup(),playerAccount=f.svm.getAccount(f.player.address);
 const receiptRent=f.svm.minimumBalanceForRentExemption(137n);
 f.svm.setAccount({...playerAccount,lamports:lamports(receiptRent+1_000n)});
 const {logs}=await rejectedClaim(f,{},/insufficient lamports|insufficient funds/i);
 assert.ok(logs.filter(line=>line.includes('Instruction: TransferChecked')).length>=2,'failure must occur after both real token transfers');
});
test('reserve must cover the entire gross claim plus the configured safety reserve',async()=>{
 const f=await setup({funding:GROSS});await rejectedClaim(f,{},/BackingRequired/);
});
test('per-claim and per-player daily limits bound actual SVM payouts',async()=>{
 const f=await setup({limits:{max:GROSS,player:GROSS,global:GROSS,lifetime:GROSS*3n}});
 await rejectedClaim(f,{gross:GROSS+1n},/LimitExceeded/);
 const {ix}=await claim(f);await send(f,[ix]);await rejectedClaim(f,{},/LimitExceeded/);
 setClock(f.svm,f.svm.getClock().unixTimestamp+86_400n);const next=await claim(f);await send(f,[next.ix]);
});
test('global daily limit applies across two distinct eligible players',async()=>{
 const first=await setup({limits:{max:GROSS,player:GROSS,global:GROSS,lifetime:GROSS*3n}}),second=await anotherPlayer(first);
 setClock(first.svm,first.svm.getClock().unixTimestamp+AGE);
 const one=await claim(first);await send(first,[one.ix]);
 await rejectedClaim(second,{},/LimitExceeded/);
 setClock(first.svm,first.svm.getClock().unixTimestamp+86_400n);
 const two=await claim(second);await send(second,[two.ix]);
});
test('lifetime cap survives day changes and stops further payouts without charging',async()=>{
 const f=await setup({limits:{max:GROSS,player:GROSS,global:GROSS,lifetime:GROSS*2n}});
 for(let i=0;i<2;i++){const {ix}=await claim(f);await send(f,[ix]);setClock(f.svm,f.svm.getClock().unixTimestamp+86_400n);}
 await rejectedClaim(f,{},/LimitExceeded/);
});

test('unchanged published ELF accepts U64 MAX caps and zero safety, pays above old limits, depletes and resumes after real Token-2022 replenishment',async()=>{
 assert.equal(createHash('sha256').update(programBytes).digest('hex'),'534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3','this regression must execute the exact published ELF, without rebuilding');
 const HTW=1_000_000n,MAX=18_446_744_073_709_551_615n;
 const first=await setup({funding:60_000_000n*HTW,sourceFunding:100_000_000n*HTW,limits:{max:MAX,player:MAX,global:MAX,lifetime:MAX,safety:0n}});
 const config=Buffer.from(first.svm.getAccount(first.config).data);
 for(const offset of [88,96,104,112])assert.equal(config.readBigUInt64LE(offset),MAX);
 assert.equal(config.readBigUInt64LE(120),0n);
 const second=await anotherPlayer(first);setClock(first.svm,first.svm.getClock().unixTimestamp+AGE);
 const start=balances(first),otherStart=balances(second),firstClaim=await claim(first,{gross:55_000_000n*HTW});
 await send(first,[firstClaim.ix],{payer:first.player});
 assert.equal(tokenAmount(first,first.reserve),5_000_000n*HTW);
 assert.equal(tokenAmount(first,first.playerAta)-start.player,53_350_000n*HTW);
 assert.equal(tokenAmount(first,first.feeAta)-start.fee,1_650_000n*HTW);
 const secondClaim=await claim(second,{gross:5_000_000n*HTW});await send(second,[secondClaim.ix],{payer:second.player});
 assert.equal(tokenAmount(first,first.reserve),0n);
 assert.equal(tokenAmount(second,second.playerAta)-otherStart.player,4_850_000n*HTW);
 await rejectedClaim(first,{},/BackingRequired/);await rejectedClaim(second,{},/BackingRequired/);
 await send(first,[getTransferCheckedInstruction({source:first.creatorAta,mint:MINT,destination:first.reserve,authority:first.creator,amount:10_000_000n*HTW,decimals:6})]);
 const replenishedClaim=await claim(first,{gross:10_000_000n*HTW});await send(first,[replenishedClaim.ix],{payer:first.player});
 assert.equal(tokenAmount(first,first.reserve),0n);
 const finalConfig=Buffer.from(first.svm.getAccount(first.config).data),firstState=Buffer.from(first.svm.getAccount(first.playerState).data);
 assert.equal(finalConfig.readBigUInt64LE(136),70_000_000n*HTW,'global daily payouts exceed the old 1.8m limit');
 assert.equal(finalConfig.readBigUInt64LE(144),70_000_000n*HTW,'replenishment remains usable after 54m historical payouts');
 assert.equal(firstState.readBigUInt64LE(88),65_000_000n*HTW,'one player can claim more than 1m per day');
 assert.equal(tokenAmount(first,first.feeAta)-start.fee,2_100_000n*HTW,'3% remains separate and exact');
 assert.equal(first.svm.getBalance(FEE)-start.feeSol,3n*STUDIO,'each successful payout still charges 0.0025 SOL');
 await rejectedClaim(first,{},/BackingRequired/);
 const beforeReplay=balances(first);await send(first,[firstClaim.ix],{success:false});assert.deepEqual(balances(first),beforeReplay);
});

test('MAX caps and zero safety preserve the minimum claim, 2500 pre-payout holding and first-claim registration age',async()=>{
 const MAX=18_446_744_073_709_551_615n,limits={max:MAX,player:MAX,global:MAX,lifetime:MAX,safety:0n};
 const young=await setup({limits,mature:false});await rejectedClaim(young,{},/AccountTooNew/);
 setClock(young.svm,NOW+AGE);await rejectedClaim(young,{gross:GROSS-1n},/MinimumClaim/);
 const lowHolding=await setup({limits,holding:HOLDING-1n});await rejectedClaim(lowHolding,{},/HoldingRequired/);
 const exact=await setup({limits,funding:GROSS}),{ix}=await claim(exact);await send(exact,[ix]);
 assert.equal(tokenAmount(exact,exact.reserve),0n,'zero safety does not retain the former six-million floor');
});
test('wrong mint, fee destination, noncanonical player account and remaining accounts reject atomically',async()=>{
 const f=await setup(),otherMint=(await generateKeyPairSigner()).address;mintFixture(f.svm,otherMint);
 const noncanonical=(await generateKeyPairSigner()).address;
 const original=f.svm.getAccount(f.playerAta);f.svm.setAccount({...original,address:noncanonical});
 for(const [terms,error] of [[{mint:otherMint},/ConstraintAddress/],[{feeWallet:f.attacker.address},/ConstraintTokenOwner/],[{feeTokens:f.playerAta},/ConstraintDuplicateMutableAccount/],[{playerTokens:noncanonical},/ConstraintAssociated/],[{remaining:[meta(f.attacker.address)]},/UnexpectedAccounts/]])await rejectedClaim(f,terms,error);
});
test('creator cannot transfer reserve tokens directly or invoke an administrator withdrawal',async()=>{
 const f=await setup(),before=balances(f);
 await send(f,[getTransferCheckedInstruction({source:f.reserve,mint:MINT,destination:f.creatorAta,authority:f.creator,amount:GROSS,decimals:6})],{success:false,error:/owner does not match|owner mismatch/i});
 await send(f,[instruction('withdraw',[meta(f.creator,true),meta(f.config,true),meta(f.reserve,true),meta(f.creatorAta,true)],u64(GROSS))],{success:false,error:/InstructionFallbackNotFound|Fallback functions are not supported/});
 assert.deepEqual(balances(f),before);
});
test('delegated reserve and unsupported mint extensions reject before payout',async()=>{
 const f=await setup(),reserve=f.svm.getAccount(f.reserve),decoded=getTokenDecoder().decode(reserve.data);
 const badReserve=getTokenEncoder().encode({...decoded,delegate:f.attacker.address,delegatedAmount:1n});
 f.svm.setAccount({...reserve,data:badReserve,space:BigInt(badReserve.length)});
 await rejectedClaim(f,{},/ReserveAuthorityChanged/);
 f.svm.setAccount(reserve);
 const mint=f.svm.getAccount(MINT),extended=new Uint8Array(202);
 extended.set(mint.data.subarray(0,82));extended[165]=1; // Token-2022 Mint account type.
 new DataView(extended.buffer).setUint16(166,3,true); // MintCloseAuthority extension.
 new DataView(extended.buffer).setUint16(168,32,true);extended.set(addressBytes(f.attacker.address),170);
 fixtureAccount(f.svm,MINT,TOKEN,extended);
 await rejectedClaim(f,{},/UnsupportedExtension/);
});
test('pre-funding a claim receipt PDA cannot redirect payouts or bypass claim validation',async()=>{
 const f=await setup(),terms=await claim(f);
 await send(f,[getTransferSolInstruction({source:f.attacker,destination:terms.receipt,amount:lamports(1_000_000n)})]);
 await send(f,[terms.ix]);
 assert.equal(f.svm.getAccount(terms.receipt).programAddress,PROGRAM);
});
