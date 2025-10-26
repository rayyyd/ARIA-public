import * as FileSystem from "expo-file-system";
import OpenAI from "openai";
import { Platform } from "react-native";


const EXPO_PUBLIC_ASI_ONE_API_KEY = process.env.EXPO_PUBLIC_ASI_ONE_API_KEY;
const EXPO_PUBLIC_OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

const openai_client = new OpenAI({
    apiKey: EXPO_PUBLIC_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
});
export class NodeServerInterface {
    private base64Image: string | undefined;
    private prompt: string | undefined;
    private readonly sessionId: string = `${Platform.OS}-session-${Math.random().toString(36).slice(2,8)}`;
    private readonly messageLogs: { role: string; message: string }[] = [];

    // use default field initializers; no constructor needed

    private _setBase64Image(base64Image: string) {
        this.base64Image = base64Image;
    }

    private _setPrompt(prompt: string) {
        this.prompt = prompt;
    }

    private _resetFields() {
        this.base64Image = undefined;
        this.prompt = undefined;
    }

    private _addLog(role: string, message: string) {
        try {
            this.messageLogs.push({ role, message });
        } catch {}
    }

    private _getLogsJson(): string {
        try {
            return JSON.stringify(this.messageLogs);
        } catch {
            return "[]";
        }
    }

    public async addImage(input: string | { uri?: string; base64?: string }) {
        let base64Image: string | undefined;

        if (typeof input === "string") {
            base64Image = input.startsWith("data:image/") ? (input.split(",")[1] ?? "") : input;
        } else if (input?.base64) {
            base64Image = input.base64;
        } else if (input?.uri) {
            try {
                base64Image = await FileSystem.readAsStringAsync(input.uri, { encoding: "base64" as any });
            } catch (e) {
                console.error("Failed reading image uri as base64:", e);
            }
        }

        if (!base64Image) {
            throw new Error("Unsupported image input; expected base64 string or { uri | base64 }.");
        }

        this._setBase64Image(base64Image);
    }

    public addPrompt(prompt: string) {
        this._setPrompt(prompt);
    }

    public async transcribeAudioFromFile(uri: string, mimeType: string = "audio/m4a"): Promise<string> {
        const apiKey = EXPO_PUBLIC_OPENAI_API_KEY;
        console.log("starting transcribe");
        if (!apiKey) {
            console.error("Missing OpenAI API key. Set EXPO_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY.");
            return "";
        }

        const form = new FormData();
        form.append("file", {
            // React Native FormData file object
            uri,
            name: "audio.m4a",
            type: mimeType,
        } as any);
        form.append("model", "gpt-4o-mini-transcribe");

        try {
            const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                body: form,
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error("Transcription failed", res.status, errText);
                return "";
            }
            
            const data = await res.json() as { text?: string };
            console.log("transcription given with output: " +  data.text);
            return data.text ?? "";
        } catch (e) {
            console.error("Transcription error", e);
            return "";
        }
    }

    async getResponse() {
        const prompt = this.prompt;
        const base64Image = this.base64Image;
        console.log("processing on-device with prompt:", prompt);
        if (!prompt || !base64Image) {
            console.error("Prompt and base64Image are required");
            return "Problem with prompt and Image input.";
        }

        const asiKey = EXPO_PUBLIC_ASI_ONE_API_KEY;
        const openaiKey = EXPO_PUBLIC_OPENAI_API_KEY;
        if (!asiKey) {
            console.warn("Missing ASI API key. Set EXPO_PUBLIC_ASI_ONE_API_KEY or ASI_ONE_API_KEY.");
        }
        if (!openaiKey) {
            console.warn("Missing OpenAI API key. Set EXPO_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY.");
        }

        try {
            let output_text = "";

            // Initial consultation to choose V / A / B or direct answer
            const initial_messages = [
                { role: 'user', content: "here are the previous message logs: " + this._getLogsJson() },
                { role: 'user', content: "you are an assistant for a wearable device. your job is to determine if the prompt requires visual information to be used, or if it requires agentic AI to be used, or both. if only visual information is required, reply with the character 'v' and nothing else. if only agentic AI is required, reply with the character 'a' and nothing else. if both are required, reply with the character 'b' and nothing else. Otherwise, if it is some common knowledge that you are already confident in, simply reply to the prompt as normal in a sentence." },
                { role: 'user', content: prompt },
            ];
            const initial_consultation = await this._askFast(initial_messages);

            let visual_info = "not available";
            if (initial_consultation.trim() === 'v') {
                visual_info = await this._getVisualInfo(base64Image);
                const messages = [
                    { role: 'user', content: "here are the previous message logs: " + this._getLogsJson() },
                    { role: 'user', content: "you are a helpful assistant on a wearbale device that can answer questions and help with tasks. you can use the visual information to help you answer the question. you can also use the web search to help you answer the question. you can also use the previous message logs to help you answer the question. answer in one sentence." },
                    { role: 'user', content: "here is the visual information as gathered by the wearable: " + visual_info },
                    { role: 'user', content: prompt }
                ];
                const reply = await this._askNonAgentic(messages);
                const thinkMatch = reply.match(/<think>[\s\S]*?<\/think>/i);
                output_text = thinkMatch ? reply.replace(thinkMatch[0], '').trim() : reply.trim();
            } else if (initial_consultation.trim() === 'b') {
                visual_info = await this._getVisualInfo(base64Image);
                const messages = [
                    { role: 'system', content: "here are the previous message logs: " + this._getLogsJson() },
                    { role: 'system', content: "you are a helpful assistant on a wearbale device that can answer questions and help with tasks. you can use the visual information to help you answer the question. you can also use the web search to help you answer the question. you can also use the previous message logs to help you answer the question. Do not reach out to the agent verse until absolutely required." },
                    { role: 'system', content: "here is the visual information as gathered by the wearable: " + visual_info },
                    { role: 'user', content: prompt }
                ];
                const reply = await this._askAgentic(messages);
                const thinkMatch = reply.match(/<think>[\s\S]*?<\/think>/i);
                output_text = thinkMatch ? reply.replace(thinkMatch[0], '').trim() : reply.trim();
            } else if (initial_consultation.trim() === 'a') {
                visual_info = "not available";
                const messages = [
                    { role: 'system', content: "here are the previous message logs: " + this._getLogsJson() },
                    { role: 'system', content: "you are a helpful assistant on a wearbale device that can answer questions and help with tasks. you can also use the previous message logs to help you answer the question. if you don't need to use the agent verse, then don't use it. give all answers in a sentence." },
                    { role: 'user', content: prompt }
                ];
                const reply = await this._askAgentic(messages);
                const thinkMatch = reply.match(/<think>[\s\S]*?<\/think>/i);
                output_text = thinkMatch ? reply.replace(thinkMatch[0], '').trim() : reply.trim();
            } else {
                visual_info = "not available";
                output_text = initial_consultation;
            }

            this._addLog('user-prompt', prompt);
            this._addLog('visual-context', visual_info);
            this._addLog('assistant-output', output_text);

            this._resetFields();
            return output_text;
        } catch (e) {
            console.error("Error computing response:", e);
            return "Failed to compute response.";
        }
    }

    private async _getVisualInfo(imageBase64: string): Promise<string> {
        console.log("getting visual info with image base64 length: " + imageBase64.length);
        const content: any = [
            { type: "input_text", text: "describe the image in detail, using a json-like format to label position of objects, what the object is, any actions, readable text, branding and other information." }
        ];
        if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 0) {
            content.push({
                type: "input_image",
                image_url: `data:image/jpeg;base64,${imageBase64}`
            });
        }
    
        const response = await openai_client.responses.create({
            model: "gpt-4.1-mini",
            input: [
                {
                    role: "user",
                    content
                }
            ]
        });
        console.log("visual info response: " + response.output_text);
        return response.output_text;
    }

    private async _askFast(messages: any[]): Promise<string> {
        const apiKey = EXPO_PUBLIC_ASI_ONE_API_KEY;
        const url = 'https://api.asi1.ai/v1/chat/completions';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'asi1-fast',
                    'x-session-id': this.sessionId,
                    messages,
                    web_search: false,
                }),
            });
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content ?? "";
            console.log("[ASI fast] output_text:", text);
            return text;
        } catch (e) {
            console.error("askFast error", e);
            return "";
        }
    }

    private async _askNonAgentic(messages: any[]): Promise<string> {
        const apiKey = EXPO_PUBLIC_ASI_ONE_API_KEY;
        const url = 'https://api.asi1.ai/v1/chat/completions';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'asi1-mini',
                    'x-session-id': this.sessionId,
                    messages,
                    web_search: false,
                }),
            });
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content ?? "";
            console.log("[ASI mini] output_text:", text);
            return text;
        } catch (e) {
            console.error("askNonAgentic error", e);
            return "";
        }
    }

    private async _askAgentic(messages: any[]): Promise<string> {
        const apiKey = EXPO_PUBLIC_ASI_ONE_API_KEY;
        const url = 'https://api.asi1.ai/v1/chat/completions';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'x-session-id': this.sessionId,
                },
                body: JSON.stringify({
                    model: 'asi1-fast-agentic',
                    messages,
                    stream: false,
                }),
            });
            const data = await res.json() as any;
            const text = data?.choices?.[0]?.message?.content ?? "";
            console.log("[ASI agentic] output_text:", text);
            return text;
        } catch (e) {
            console.error("askAgentic error", e);
            return "";
        }
    }
}