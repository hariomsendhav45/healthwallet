export type AiMessage = { question: string; language: 'en' | 'hi'; context: string };
export interface AiProvider {
  readonly name: string;
  health(): Promise<boolean>;
  answer(message: AiMessage): Promise<string>;
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');
