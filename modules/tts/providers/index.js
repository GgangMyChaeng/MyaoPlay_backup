/**
 * TTS Providers Registry
 * - 새 provider 추가할 때 여기만 건드리면 됨
 */

import * as qwen from "./qwen.js";
import * as openai from "./openai.js";
import * as gemini from "./gemini.js";
import * as lmnt from "./lmnt.js";
import * as elevenlabs from "./elevenlabs.js";

export const providers = {
  qwen: {
    ...qwen.meta,
    getAudioUrl: qwen.getAudioUrl,
  },
  openai: {
    ...openai.meta,
    getAudioUrl: openai.getAudioUrl,
  },
  gemini: {
    ...gemini.meta,
    getAudioUrl: gemini.getAudioUrl,
  },
  lmnt: {
    ...lmnt.meta,
    getAudioUrl: lmnt.getAudioUrl,
  },
  elevenlabs: {
    ...elevenlabs.meta,
    getAudioUrl: elevenlabs.getAudioUrl,
  },
};

export const getProvider = (id) => providers[id] || null;
export const getProviderList = () => Object.values(providers);
export const getProviderIds = () => Object.keys(providers);
