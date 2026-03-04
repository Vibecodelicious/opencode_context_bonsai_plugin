import type { Event as V1Event } from "@opencode-ai/sdk";
import type { WithParts } from "./test/fixtures";
export declare function handleTokenEvent(event: V1Event): void;
export declare function formatGaugeText(used: number, modelLimit: number, percent: number): string;
export declare function handleChatParams(sessionID: string, model: any): void;
export declare function injectGauge(messages: WithParts[], sessionID: string, pluginID: string): void;
