import { expect,test } from "bun:test";
import { decodedPreviewV1, segmentText } from "../../src/techniques.js";
test("decoded previews preserve original, decode once, and ignore binary or invalid Base64",()=>{
 const plain="Summarize the quarterly sales report.";
 const encoded=Buffer.from(plain).toString("base64");
 expect(decodedPreviewV1(encoded)).toStartWith(encoded);
 expect(decodedPreviewV1(encoded)).toContain(plain);
 expect(decodedPreviewV1(plain)).toBe(plain);
 expect(decodedPreviewV1(Buffer.from([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]).toString("base64"))).not.toContain("[View");
 const twice=Buffer.from(encoded).toString("base64");
 expect(decodedPreviewV1(twice)).not.toContain(plain);
 expect(segmentText(encoded,{kind:"decoded_preview_v1"})).toEqual([{index:0,text:decodedPreviewV1(encoded)}]);
});
test("Unicode and percent previews are deterministic and bounded",()=>{
 expect(decodedPreviewV1("Ｓｕｍｍａｒｉｚｅ\u200b this report")).toContain("Summarize this report");
 expect(decodedPreviewV1("Read%20this%20report")).toContain("Read this report");
 expect(decodedPreviewV1("\\u0052ead this report")).toContain("Read this report");
 expect(decodedPreviewV1("bad%XY")).toBe("bad%XY");
 const input=Array.from({length:20},(_,i)=>Buffer.from(`${i} ${"words ".repeat(1500)}`).toString("base64")).join("\n");
 const result=decodedPreviewV1(input);
 expect(result).toBe(decodedPreviewV1(input));
 expect(result.length-input.length).toBeLessThan(33000);
});
