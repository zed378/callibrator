/**
 * P22-10c2 — jsdom (the component suites' environment) has no `structuredClone`, which IndexedDB
 * (`fake-indexeddb`) needs to store a record. This gives jsdom node's own structured clone, through a
 * `MessageChannel` read synchronously — the same algorithm a browser applies, CryptoKey included.
 */
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

const nodeClone = <T>(value: T): T => {
  const { port1, port2 } = new MessageChannel();
  try {
    port1.postMessage(value);
    return (receiveMessageOnPort(port2) as { message: T }).message;
  } finally {
    port1.close();
    port2.close();
  }
};

if (typeof globalThis.structuredClone !== "function") {
  (globalThis as { structuredClone: typeof structuredClone }).structuredClone = nodeClone as typeof structuredClone;
}
