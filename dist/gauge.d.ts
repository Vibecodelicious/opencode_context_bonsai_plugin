import type { Event } from "@opencode-ai/sdk";
import type { WithParts } from "./test/fixtures";
export declare function handleTokenEvent(event: Event): void;
export declare function handleChatParams(sessionID: string, model: any): void;
export declare function injectGauge(messages: WithParts[], sessionID: string, pluginID: string): void;
