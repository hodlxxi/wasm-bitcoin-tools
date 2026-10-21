#!/usr/bin/env node
// Browser acceptance: a REAL v86 Alpine boot and REAL Bitcoin Core RPC in Chrome.
// No private keys, no transactions broadcast. Esplora responses are mocked here.
// Separate live-probe workflow tests real public Esplora network reads.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const rootUrl = process.env.CONTRACT_VERIFIER_TEST_URL || "http://127.0.0.1:8765/";
const artifacts = process.env.CONTRACT_VERIFIER_TEST_OUTPUT || "/tmp/contract-verifier-browser";
mkdirSync(artifacts, {recursive:true});

const browser = await chromium.launch({channel:"chrome",headless:true,args:[
 "--no-sandbox","--disable-dev-shm-usage","--disable-gpu"
]});
const page = await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:false});
const errors=[];
page.on("pageerror", e => {errors.push(e.stack || String(e));console.error("PAGEERROR",String(e));});
page.on("console", m => {if(m.type()==="error")console.error("CONSOLE_ERROR",m.text());});
page.on("requestfailed", r => console.error("REQUEST_FAILED",r.url(),r.failure()?.errorText));
let apiRequests=0;
await page.route("https://mempool.space/**", async route=>{
 apiRequests++;
 const url=new URL(route.request().url());
 const path=url.pathname;
 const addr=path.split("/address/")[1]?.split("/")[0];
 if(!addr) return route.fulfill({status:404,body:"missing address"});
 const isAgent=addr==="bc1qsrpjjn3w8ly8da7u59y7ywzly4he7lfnl8462qrxp3d368gexess3tjdz3";
 const data=path.endsWith("/utxo")?isAgent?[]:[
  {txid:"a".repeat(64),vout:0,value:123000,status:{confirmed:true,block_height:905774}},
  {txid:"b".repeat(64),vout:1,value:177000,status:{confirmed:true,block_height:865847}}
 ]: path.endsWith("/txs")?isAgent?[]:[
  {txid:"a".repeat(64),status:{confirmed:true,block_height:905774}}
 ]:[];
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data),
  headers:{"Access-Control-Allow-Origin":"*"}});
});
const mark=(label,s)=>console.log("BROWSER_STEP",label,s||"");
async function waitingForStatus(id,needle,timeout=210000){
 await page.waitForFunction(({id,needle})=>document.getElementById(id)?.textContent.includes(needle),{id,needle},{timeout});
 return await page.locator("#"+id).innerText();
}
try{
 mark("open",rootUrl);
 await page.goto(new URL("apps/contract-verifier.html",rootUrl).href,{waitUntil:"domcontentloaded",timeout:60000});
 const sampleA=page.locator("#example_human");
 await sampleA.click();
 await waitingForStatus("verify_status","Loaded Human mirrored leg A",15000);
 if(await page.locator("#fund").isEnabled())throw Error("Funding must be disabled before Bitcoin Core verification");
 if(apiRequests!==0)throw Error("Unexpected third-party Esplora network access before consent");
 mark("waiting guest boot");
 await waitingForStatus("machine_status","Ready · offline Bitcoin Core guest",230000);
 mark("guest boot complete");
 await page.locator("#verify").click();
 const message=await waitingForStatus("verify_status","Bitcoin Core decoded the input and derived an address",150000);
 mark("human Bitcoin Core RPC verified",message);
 let values=await page.locator("#facts").innerText();
 if(!values.includes("777 blocks")||!values.includes("bc1qqkkhxvyy3lk063n7l0jdr0xs7drgxck02lsep2gux3dk8g2jayesshrwfu"))
   throw Error("Incorrect human contract height or address\n"+values);
 if(apiRequests!==0)throw Error("No external funding lookup may occur without click");
 await page.locator("#fund").click();
 await waitingForStatus("funding_status","API query completed",25000);
 values=await page.locator("#funding_facts").innerText();
 if(!values.includes("0.00300000 BTC"))throw Error("Mocked API balance missing: "+values);
 if(apiRequests!==2)throw Error("Expected explicit two Esplora endpoint calls; got "+apiRequests);
 mark("opt-in Esplora mock check",values.replace(/\n/g," "));
 // A changed input must not leave a usable stale funding address in the UI.
 const priorInput=await page.locator("#contract_input").inputValue();
 await page.locator("#contract_input").fill(priorInput+" ");
 if(await page.locator("#fund").isEnabled())throw Error("Funding must be invalidated when the public script is changed");
 if(!(await page.locator("#result").isHidden()))throw Error("Old validation should disappear after input change");
 mark("stale funding state invalidation verified");
 // A verifier is per contract; the second funded human mirror is a separate address.
 await page.locator("#example_human_mirror").click();
 await waitingForStatus("verify_status","Loaded Human mirrored leg B",15000);
 await page.locator("#verify").click();
 await waitingForStatus("verify_status","Bitcoin Core decoded the input and derived an address",150000);
 values=await page.locator("#facts").innerText();
 if(!values.includes("777 blocks") ||
    !values.includes("bc1qrj4kfdsrrc58z6wu0es8f5a7t9ez35d2pnr8ylvk3hcek2lp5e2qh25t09"))
    throw Error("Wrong Bitcoin Core result for funded human mirrored leg B: "+values);
 await page.locator("#fund").click();
 await waitingForStatus("funding_status","API query completed",25000);
 if(!(await page.locator("#funding_facts").innerText()).includes("0.00300000 BTC"))
    throw Error("Missing mocked 300000-sat mirror funding balance");
 if(apiRequests!==4)throw Error("Expected four opt-in Esplora requests for two human legs");
 mark("mirrored human B Bitcoin Core and opt-in Esplora mock verified");

 await page.locator("#example_agent").click();
 await waitingForStatus("verify_status","Loaded Operator-agent cooperative leg",15000);
 if(await page.locator("#fund").isEnabled())throw Error("Funding should reset on new input");
 await page.locator("#verify").click();
 await waitingForStatus("verify_status","Bitcoin Core decoded the input and derived an address",150000);
 values=await page.locator("#facts").innerText();
 if(!values.includes("144 blocks")||!values.includes("cooperative_2_of_2_cltv")||
 !values.includes("bc1qsrpjjn3w8ly8da7u59y7ywzly4he7lfnl8462qrxp3d368gexess3tjdz3"))
   throw Error("Incorrect operator-agent contract interpretation\n"+values);
 mark("agent Bitcoin Core RPC verified");
 await page.locator("#fund").click();
 await waitingForStatus("funding_status","API query completed",25000);
 const agentFacts=await page.locator("#funding_facts").innerText();
 if(!agentFacts.includes("0.00000000 BTC"))throw Error("Mocked agent empty API balance missing");
 if(apiRequests!==6)throw Error("Expected 6 explicitly triggered API requests for 3 contracts");

 if(errors.length)throw Error("Browser page errors: "+errors.join("\n"));
 await page.screenshot({path:artifacts+"/verifier-success.png",fullPage:true});
 mark("ALL_BROWSER_ACCEPTANCE_PASS",{apiRequests,guestBoot:true,coreRPC:true,contractFamilies:2,contractsChecked:3,thirdPartyReadsOptIn:true});
}catch(e){
 console.error("BROWSER_ACCEPTANCE_FAILED",e.stack||e);
 console.error("GUEST_SERIAL_TAIL",(await page.locator("#serial").innerText().catch(()=>"")).slice(-10000));
 console.error("MACHINE_STATUS",await page.locator("#machine_status").innerText().catch(()=>""));
 console.error("VERIFY_STATUS",await page.locator("#verify_status").innerText().catch(()=>""));
 await page.screenshot({path:artifacts+"/verifier-failure.png",fullPage:true}).catch(()=>{});
 writeFileSync(artifacts+"/errors.txt",String(e.stack||e)+"\n"+errors.join("\n"));
 process.exitCode=1;
}finally {
 await browser.close();
}
