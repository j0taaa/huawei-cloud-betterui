import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import {
  applySourceEdits,
  bytesToBase64,
  buildZipPayload,
  previewFunctionPackage,
  readFunctionPackage,
  readZipPackage,
  serializeFunctionPackage,
} from "@/lib/functiongraph/package";
import { addFunctionGraphFunctionDependency } from "@/lib/huawei/services/functiongraph";
import { session } from "./fixtures/session";

test("editing a ZIP preserves binary assets, Unicode, empty files, and files beyond the preview limit", () => {
  const files = [
    { name: "index.py", content: new TextEncoder().encode("print('ação')") },
    { name: "asset.png", content: new Uint8Array([0, 255, 12, 128]) },
    { name: "empty.dat", content: new Uint8Array() },
    ...Array.from({ length: 35 }, (_, i) => ({
      name: `source-${i}.py`,
      content: new TextEncoder().encode(`print(${i})`),
    })),
  ];
  const pkg = readFunctionPackage({
    codeFile: "original.zip",
    codePayload: buildZipPayload(files),
    codeText: "",
    codeType: "zip",
    handler: "index.handler",
  });
  assert.equal(previewFunctionPackage(pkg).length, 30);
  const saved = serializeFunctionPackage(
    applySourceEdits(pkg, { "index.py": "print('updated')" }),
  );
  assert.equal(saved.codeType, "zip");
  assert.equal(saved.codeFilename, "original.zip");
  const uploaded = readZipPackage(saved.codePayload);
  assert.equal(uploaded.length, files.length);
  assert.equal(
    new TextDecoder().decode(uploaded[0].content),
    "print('updated')",
  );
  for (let i = 1; i < files.length; i++)
    assert.deepEqual(uploaded[i], files[i]);
});

test("a ZIP with a single previewable source stays a complete ZIP on save", () => {
  const original = [
    { name: "index.py", content: new TextEncoder().encode("original") },
    { name: "native.so", content: new Uint8Array([0, 255]) },
  ];
  const pkg = readFunctionPackage({
    codeFile: "function.zip",
    codePayload: buildZipPayload(original),
    codeText: "",
    codeType: "zip",
    handler: "index.handler",
  });
  assert.equal(previewFunctionPackage(pkg).length, 1);
  const saved = serializeFunctionPackage(
    applySourceEdits(pkg, { "index.py": "updated" }),
  );
  assert.equal(saved.codeType, "zip");
  assert.deepEqual(readZipPackage(saved.codePayload)[1], original[1]);
});

test("invalid and oversized packages fail before an upload can be built", () => {
  assert.throws(() => readZipPackage(bytesToBase64(new Uint8Array([1, 2, 3]))));
  const bomb = bytesToBase64(
    zipSync({ "oversized.py": new Uint8Array(7_000_001) }, { level: 9 }),
  );
  assert.throws(() => readZipPackage(bomb), /7 MB/);
  assert.throws(
    () =>
      buildZipPayload([
        { name: "duplicate", content: new Uint8Array() },
        { name: "duplicate", content: new Uint8Array() },
      ]),
    /Duplicate/,
  );
});

test("inline editing retains its type and Unicode source", () => {
  const pkg = readFunctionPackage({
    codeFile: "index.py",
    codePayload: "",
    codeText: "print('你好')",
    codeType: "inline",
    handler: "index.handler",
  });
  const saved = serializeFunctionPackage(
    applySourceEdits(pkg, { "index.py": "print('ação')" }),
  );
  assert.equal(saved.codeType, "inline");
  assert.equal(
    Buffer.from(saved.codePayload, "base64").toString(),
    "print('ação')",
  );
});

test("dependency updates preserve all 501 original files and binary bytes", async (t) => {
  const original = Array.from({ length: 501 }, (_, i) => ({
    name: `file-${i}.py`,
    content: new TextEncoder().encode(`print(${i})`),
  }));
  original.push({ name: "asset.bin", content: new Uint8Array([0, 255, 128]) });
  const payload = buildZipPayload(original);
  let uploaded = "";
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      if (input.includes("/code")) {
        if (init?.method === "PUT")
          uploaded = JSON.parse(String(init.body)).func_code.file;
        return Response.json({
          code_type: "zip",
          code_filename: "function.zip",
          func_code: { file: payload },
        });
      }
      if (input.includes("/config")) return Response.json({});
      return Response.json({
        functions: [
          {
            func_name: "fn-1",
            func_urn:
              "urn:fss:sa-brazil-1:project-1:function:default:fn-1:latest",
            runtime: "Python3.9",
          },
        ],
      });
    },
  );
  await addFunctionGraphFunctionDependency(session, "fn-1", {
    dependencyName: "requests",
    version: "2.32.0",
  });
  const files = readZipPackage(uploaded);
  assert.equal(files.length, original.length + 1);
  for (const file of original)
    assert.deepEqual(
      files.find((f) => f.name === file.name),
      file,
    );
  assert.equal(
    new TextDecoder().decode(
      files.find((f) => f.name === "requirements.txt")!.content,
    ),
    "requests==2.32.0\n",
  );
});

test("dependency editing rejects an invalid ZIP without submitting replacement code", async (t) => {
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      if (init?.method === "PUT") writes++;
      if (input.includes("/code"))
        return Response.json({
          code_type: "zip",
          code_filename: "bad.zip",
          func_code: { file: bytesToBase64(new Uint8Array([1, 2, 3])) },
        });
      if (input.includes("/config")) return Response.json({});
      return Response.json({
        functions: [
          {
            func_name: "fn-1",
            func_urn:
              "urn:fss:sa-brazil-1:project-1:function:default:fn-1:latest",
            runtime: "Python3.9",
          },
        ],
      });
    },
  );
  await assert.rejects(
    addFunctionGraphFunctionDependency(session, "fn-1", {
      dependencyName: "requests",
    }),
  );
  assert.equal(writes, 0);
});
