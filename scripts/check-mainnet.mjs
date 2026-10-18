// Read-only inspection. No wallet, signing, or transaction submission.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const programId='Aw3675He2MqACz3zkKi2hVEFpSdoYK5H8UG95kRoMD8k';
const programData='HJGvwxrc4Lt9VqcvA76h4nYcBrcCZjQUrBSoaSNZKB9G';
const loader='BPFLoaderUpgradeab1e11111111111111111111111';
const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const expectedHash='534f800c9c68c572dc8afb45103c9afce7ab3d8af272936b43cd04452014add3';
const expectedBytes=210168;
const endpoint=new URL(process.env.SOLANA_READONLY_RPC??'https://api.mainnet-beta.solana.com');
assert.equal(endpoint.protocol,'https:','Use an HTTPS mainnet RPC endpoint');
let nextId=1;
async function rpc(method,params=[]){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:nextId++,method,params}),signal:AbortSignal.timeout(20000)});
 assert.ok(response.ok,`RPC HTTP ${response.status}`);
 const reply=await response.json();
 assert.ok(!reply.error,`Read-only RPC error ${reply.error?.code??''}`);
 return reply.result;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(await rpc('getGenesisHash'),genesis,'RPC is not Solana mainnet');
const snapshot=await rpc('getAccountInfo',[programData,{encoding:'base64',commitment:'finalized'}]);
const account=snapshot.value;
assert.ok(account,'ProgramData account is missing');
assert.equal(account.owner,loader,'Unexpected ProgramData owner');
assert.equal(account.executable,false,'Unexpected ProgramData account type');
assert.equal(account.data?.[1],'base64','Unexpected account encoding');
const bytes=Buffer.from(account.data[0],'base64');
assert.equal(bytes.length,45+expectedBytes,'Unexpected deployed account length');
assert.equal(bytes.readUInt32LE(0),3,'Expected loader-v3 ProgramData');
assert.equal(bytes[12],0,'Program has an upgrade authority');
const executable=bytes.subarray(45);
assert.equal(executable.subarray(0,4).toString('hex'),'7f454c46','Expected ELF executable');
assert.equal(executable.readUInt32LE(48),3,'Expected SBPFv3');
assert.equal(sha(executable),expectedHash,'On-chain executable differs from the published expected payload');
const binaryFile=process.argv[2];
if(binaryFile){
 const rebuilt=await readFile(binaryFile);
 assert.ok(rebuilt.equals(executable),'The supplied rebuilt executable does not match mainnet byte for byte');
}
let end=executable.length;
while(end>0&&executable[end-1]===0)end--;
console.log(JSON.stringify({observedAt:new Date().toISOString(),cluster:'mainnet-beta',commitment:'finalized',contextSlot:snapshot.context.slot,programId,programData,upgradeAuthority:null,lastDeploymentSlot:String(bytes.readBigUInt64LE(4)),elfBytes:executable.length,elfSha256:sha(executable),solanaVerifyTrimmedSha256:sha(executable.subarray(0,end)),providedBinaryCompared:Boolean(binaryFile),result:'matches_expected_mainnet_payload'},null,2));
