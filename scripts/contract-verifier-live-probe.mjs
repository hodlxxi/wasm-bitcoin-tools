#!/usr/bin/env node
// Read-only live external-source check of publicly published P2WSH addresses.
// Does NOT verify Bitcoin consensus and does NOT represent CRT membership.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const fixture=JSON.parse(readFileSync(new URL("../tests/fixtures/public-contract-vectors.json",import.meta.url),"utf8"));
const endpoints=[
 {id:"mempool.space",origin:"https://mempool.space/api"},
 {id:"blockstream.info",origin:"https://blockstream.info/api"},
];
const sats=a=>a.reduce((sum,u)=>sum+u.value,0);
async function getJson(base,path) {
 const url=base+path;
 const r=await fetch(url,{headers:{"accept":"application/json"},signal:AbortSignal.timeout(20000),cache:"no-store"});
 if(!r.ok)throw Error("HTTP "+r.status);
 return r.json();
}
function checkStats(data){
 const c=data?.chain_stats,m=data?.mempool_stats;
 if(!c||!m)throw Error("Invalid address stats shape");
 for(const x of [c,m])for(const k of ["funded_txo_sum","spent_txo_sum","funded_txo_count","spent_txo_count"])
  if(!Number.isSafeInteger(x[k])||x[k]<0)throw Error("Invalid "+k);
 return {confirmedBalance:c.funded_txo_sum-c.spent_txo_sum,
 unconfirmedChange:m.funded_txo_sum-m.spent_txo_sum,txCountConfirmed:c.tx_count};
}
function checkUtxos(rows){
 if(!Array.isArray(rows))throw Error("Invalid UTXO JSON shape");
 for(const u of rows)if(!/^[0-9a-f]{64}$/.test(u.txid)||!Number.isSafeInteger(u.value)||u.value<0||
 !Number.isInteger(u.vout)||u.vout<0||typeof u.status?.confirmed!=="boolean")throw Error("Invalid UTXO record");
 return {
 confirmed:rows.filter(u=>u.status.confirmed),
 unconfirmed:rows.filter(u=>!u.status.confirmed),
 };
}
let failed=0,available=0;
for(const v of fixture.vectors) {
 const hash=createHash("sha256").update(Buffer.from(v.script_hex,"hex")).digest("hex");
 if(hash!==v.witness_script_sha256)throw Error("Fixture script checksum disagrees: "+v.name);
 console.log("\nCONTRACT "+v.name+"\n  ADDRESS "+v.p2wsh_address+"\n  SCRIPT_HASH "+hash+"\n  SNAPSHOT_UTC "+new Date().toISOString());
 const snapshots=[];
 for(const provider of endpoints) {
  try{
   const path="/address/"+encodeURIComponent(v.p2wsh_address);
   const [statsJson,utxoJson]=await Promise.all([
    getJson(provider.origin,path),
    getJson(provider.origin,path+"/utxo"),
   ]);
   const stats=checkStats(statsJson),utxos=checkUtxos(utxoJson);
   const unspentConfirmed=sats(utxos.confirmed),unspentUnconfirmed=sats(utxos.unconfirmed);
   const data={source:provider.id,address:v.p2wsh_address,
    confirmed_utxo_sats:unspentConfirmed,unconfirmed_utxo_sats:unspentUnconfirmed,
    utxo_count:utxoJson.length,chain_stats_balance_sats:stats.confirmedBalance,
    mempool_change_sats:stats.unconfirmedChange,confirmed_tx_count:stats.txCountConfirmed,
    utxos:utxoJson.map(u=>({txid:u.txid,vout:u.vout,value_sats:u.value,confirmed:u.status.confirmed,block_height:u.status.block_height??null}))
   };
   snapshots.push(data);available++;
   console.log("  PROVIDER_RESULT "+JSON.stringify(data));
   if(stats.confirmedBalance!==unspentConfirmed)
    console.log("  WARNING: confirmed balance from /address differs from confirmed UTXO sum (may reflect unconfirmed spends/mempool snapshot race)");
  }catch(e){
   console.log("  PROVIDER_UNAVAILABLE "+provider.id+" "+String(e?.message||e));
  }
 }
 if(snapshots.length===2){
  const [a,b]=snapshots;
  if(a.confirmed_utxo_sats!==b.confirmed_utxo_sats ||
   a.unconfirmed_utxo_sats!==b.unconfirmed_utxo_sats){
   console.log("  WARNING: two external providers disagree. Neither response can be treated as verified consensus.");
  }else console.log("  EXTERNAL_SOURCES_AGREE_ON_UTXOS true (still NOT an independent consensus proof)");
 }
 if(!snapshots.length){console.log("  UNVERIFIED no external source responded");failed++;}
}
console.log("\nSUMMARY "+JSON.stringify({external_sources_successful:available,contracts_without_live_data:failed,verification_type:"third-party API observation only",snapshot_utc:new Date().toISOString()}));
if(failed)process.exitCode=1;
