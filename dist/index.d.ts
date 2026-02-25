import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import type { WithParts } from "./test/fixtures";
export declare function convertPluginMessages(messages: {
    info: Message;
    parts: Part[];
}[]): WithParts[];
export declare const contextBonsai: Plugin;
export default contextBonsai;
