import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Resolve the exact transitives used by Firebase, including nested installations.
// No app initialization, credentials, sockets or provider calls are needed.
const rootRequire = createRequire(new URL("../package.json", import.meta.url));
const firebaseRequire = createRequire(rootRequire.resolve("firebase-admin"));
const firestoreRequire = createRequire(firebaseRequire.resolve("@google-cloud/firestore"));
const protobuf = firestoreRequire("protobufjs");
const compatRequire = createRequire(
  firebaseRequire.resolve("@firebase/database-compat/standalone")
);
const databaseRequire = createRequire(compatRequire.resolve("@firebase/database"));
const fayeRequire = createRequire(databaseRequire.resolve("faye-websocket"));
const driver = fayeRequire("websocket-driver");
const storageRequire = createRequire(firebaseRequire.resolve("@google-cloud/storage"));
const { XMLParser, XMLBuilder } = storageRequire("fast-xml-parser");

function draftServer() {
  const request = {
    method: "GET",
    url: "/",
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      host: "fixture.invalid",
      origin: "https://fixture.invalid"
    }
  };
  const server = driver.http(request, { maxLength: 8 });
  server.io.on("data", () => {});
  assert.equal(server.start(), true);
  return server;
}

test("draft websocket rejects an oversized length header before any payload", () => {
  const server = draftServer();
  let messages = 0;
  server.on("message", () => {
    messages++;
  });
  // A finite three-byte fixture; no network and no large allocation.
  server.parse(Buffer.from([0x80, 0x81, 0x80]));
  assert.equal(server.getState(), "closed");
  assert.equal(messages, 0);
});

test("draft websocket still accepts a valid bounded text frame", () => {
  const server = draftServer();
  const messages = [];
  server.on("message", (event) => messages.push(event.data));
  server.parse(Buffer.from([0, ...Buffer.from("safe"), 255]));
  assert.deepEqual(messages, ["safe"]);
  assert.equal(server.getState(), "open");
  server.close();
});

test("protobuf keeps trusted-schema binary and JSON round trips", () => {
  const root = protobuf.Root.fromJSON({
    nested: {
      Fixture: {
        fields: {
          name: { type: "string", id: 1 },
          count: { type: "int32", id: 2 },
          labels: { rule: "repeated", type: "string", id: 3 }
        }
      }
    }
  });
  const type = root.lookupType("Fixture");
  const value = { name: "fixture", count: 7, labels: ["one", "two"] };
  assert.equal(type.verify(value), null);
  const decoded = type.decode(type.encode(type.fromObject(value)).finish());
  assert.deepEqual(type.toObject(decoded), value);
});

test("XML entity names cannot shadow built-in escaped characters", () => {
  const xml = '<!DOCTYPE root [<!ENTITY l. "UNEXPECTED">]><root>&lt;safe&gt;</root>';
  assert.equal(new XMLParser().parse(xml).root, "<safe>");
});

test("XML response parsing preserves namespaces, attributes and entity text", () => {
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(
    '<r:Result xmlns:r="urn:fixture" id="7"><r:Key>a&amp;b</r:Key></r:Result>'
  );
  assert.equal(parsed["r:Result"]["r:Key"], "a&b");
  assert.equal(parsed["r:Result"]["@_id"], "7");
});

test("XMLBuilder CDATA delimiters cannot create sibling elements", () => {
  const payload = "safe]]><injected>value</injected><![CDATA[end";
  const xml = new XMLBuilder({ cdataPropName: "#cdata" }).build({ root: { "#cdata": payload } });
  assert.equal(new XMLParser().parse(xml).root, payload);
});

test("XMLBuilder comment delimiters cannot create sibling elements", () => {
  const xml = new XMLBuilder({ commentPropName: "#comment" }).build({
    root: { "#comment": "--><injected>value</injected><!--", data: "safe" }
  });
  assert.deepEqual(new XMLParser().parse(xml).root, { data: "safe" });
});
