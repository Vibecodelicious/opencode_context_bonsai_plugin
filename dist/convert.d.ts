import type { Message, Part } from "@opencode-ai/sdk";
import type { WithParts } from "./test/fixtures";
export declare function convertPluginMessages(messages: {
    info: Message;
    parts: Part[];
}[]): WithParts[];
