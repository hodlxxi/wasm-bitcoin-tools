import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script, runInNewContext } from "node:vm";

// Regression vectors sourced from public HODLXXI code/artifacts.
// Static vectors are NOT proof of current on-chain funding.
const vectors = JSON.parse(readFileSync(new URL("./fixtures/public-contract-vectors.json", import.meta.url)));
const page = readFileSync(new URL("../apps/contract-verifier.html", import.meta.url), "utf8");
const inline = page.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
assert.ok(inline, "verifier inline script should exist");
new Script(inline[1], { filename: "contract-verifier-inline.js" });

const sandbox = {
    document: { getElementById: () => ({ addEventListener() {} }) },
    window: {},
};
const helpers = runInNewContext(
    inline[1]+"\n;({ parseTemplate, publicInput, hexBytes, GUEST_SCRIPT })",
    sandbox, { timeout: 1000 }
);
const sha256 = hex => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

// Independent test-only BIP173 P2WSH address encoder (not imported from verifier).
const CHARSET="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) {
    let chk=1;
    const GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
    for(const v of values) {
        const top=chk>>>25;
        chk=((chk&0x1ffffff)<<5)^v;
        for(let i=0;i<5;i++)if((top>>>i)&1)chk^=GEN[i];
    }
    return chk>>>0;
}
function bech32P2wsh(scriptHex) {
    const hrp="bc", program=Buffer.from(sha256(scriptHex),"hex");
    let acc=0,bits=0,words=[0];
    for(const byte of program) {
        acc=(acc<<8)|byte;bits+=8;
        while(bits>=5){bits-=5;words.push((acc>>>bits)&31);}
        acc&=(1<<bits)-1;
    }
    if(bits)words.push((acc<<(5-bits))&31);
    const expanded=[...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31));
    const mod=polymod([...expanded,...words,0,0,0,0,0,0])^1;
    for(let i=0;i<6;i++)words.push((mod >>> (5*(5-i))) &31);
    return hrp+"1"+words.map(w=>CHARSET[w]).join("");
}

test("public fixture set covers two different supported covenant script families",()=>{
    assert.equal(vectors.vectors.length,3);
    assert.deepEqual([...new Set(vectors.vectors.map(x=>x.family))].sort(),
        ["cltv_only","cooperative_2_of_2_cltv"]);
});
for(const v of vectors.vectors){
    test("parses known HODLXXI witnessScript: "+v.name,()=>{
        const decoded=helpers.parseTemplate(helpers.hexBytes(v.script_hex));
        assert.equal(decoded.family,v.family);
        assert.equal(decoded.ifBranch.lock,v.if.lock);
        assert.equal(decoded.elseBranch.lock,v.else.lock);
        assert.equal(decoded.ifBranch.pubkey,v.if.pubkey);
        assert.equal(decoded.elseBranch.pubkey,v.else.pubkey);
        assert.equal(decoded.delta,v.delta_blocks);
        assert.deepEqual([...decoded.cooperative],[...(v.cooperative_pubkeys||[])]);
        assert.equal(sha256(v.script_hex),v.witness_script_sha256);
        assert.equal(bech32P2wsh(v.script_hex),v.p2wsh_address);
        assert.equal(helpers.publicInput(v.script_hex),"script");
        if(v.raw_descriptor)assert.equal(helpers.publicInput(v.raw_descriptor),"raw_descriptor");
    });
}
test("published agent address agrees with independent Bitcoin witnessScript hashing",()=>{
    const agent=vectors.vectors.find(v=>v.family==="cooperative_2_of_2_cltv");
    assert.equal(agent.p2wsh_address,"bc1qsrpjjn3w8ly8da7u59y7ywzly4he7lfnl8462qrxp3d368gexess3tjdz3");
    assert.equal(agent.delta_blocks,144);
});
test("rejects truncated, altered, and trailing scripts",()=>{
    const s=vectors.vectors[0].script_hex;
    for(const altered of [s.slice(0,-2),s+"51","00"+s.slice(2)]){
        assert.throws(()=>helpers.parseTemplate(helpers.hexBytes(altered)));
    }
});
test("rejects malformed cooperative authorization",()=>{
    const agent=vectors.vectors[2];
    const s=agent.script_hex;
    const duplicated=s.replace("21023d34633c5c1b72050fede84dcc396b5ea969fa40daa2eabf24cc339959f9e92352ae",
      "2102019e7a92d22e4467e0afb20ce62976e976d1558e553351e1fb1a886b4a149f9252ae");
    assert.notEqual(duplicated,s);
    assert.throws(()=>helpers.parseTemplate(helpers.hexBytes(duplicated)));
});
test("public-only input gate recognizes raw descriptors and rejects private extended keys",()=>{
    assert.equal(helpers.publicInput("addr(bc1qexample)"),"descriptor");
    assert.equal(helpers.publicInput("raw(63ac)"),"raw_descriptor");
    assert.throws(()=>helpers.publicInput("wpkh(xprv123456789)"));
    assert.throws(()=>helpers.publicInput("63ac\nmore"));
});
test("guest enforces offline Bitcoin Core and verifies raw descriptors before script decode",()=>{
    const sh=helpers.GUEST_SCRIPT;
    assert.match(sh,/-networkactive=0/);
    assert.match(sh,/-disablewallet/);
    assert.match(sh,/MODE" = raw_descriptor/);
    assert.match(sh,/getdescriptorinfo/);
    assert.match(sh,/decodescript/);
    assert.match(sh,/@@CONTRACT_DONE/);
});
