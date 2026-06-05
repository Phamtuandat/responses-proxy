// Provider Catalog - Tier-based organization and metadata for router-focused UI

import type {
  Provider,
  ProviderTier,
  ProviderServiceKind,
  ProviderAuthType,
  ProviderRiskNotice,
  ProviderRiskLevel
} from "./providerTypes";

// Provider Catalog Entry
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tier: ProviderTier;
  serviceKinds: ProviderServiceKind[];
  authTypes: ProviderAuthType[];
  preferredAuthType: ProviderAuthType;
  defaultBaseUrl?: string;
  signupUrl?: string;
  docsUrl?: string;
  riskNotice?: ProviderRiskNotice;
  defaultModels?: string[];
  estimatedSetupTime?: string; // e.g., "2 minutes", "5 minutes"
  popularity?: number; // 1-5 scale for sorting
}

// Tier Definitions
export const PROVIDER_TIERS: Record<ProviderTier, { label: string; description: string; priority: number }> = {
  subscription: {
    label: "Subscription",
    description: "Premium paid services with high quotas and reliability",
    priority: 1
  },
  cheap: {
    label: "Cheap",
    description: "Cost-effective services with moderate quotas",
    priority: 2
  },
  free: {
    label: "Free",
    description: "Free services with limited quotas, good for fallback",
    priority: 3
  },
  custom: {
    label: "Custom",
    description: "User-defined OpenAI-compatible providers",
    priority: 4
  }
};

// Service Kind Definitions
export const SERVICE_KINDS: Record<ProviderServiceKind, { label: string; icon: string; description: string }> = {
  chat: {
    label: "Chat",
    icon: "💬",
    description: "Text generation and conversation"
  },
  embedding: {
    label: "Embeddings",
    icon: "🔢",
    description: "Text embeddings and similarity"
  },
  tts: {
    label: "Text-to-Speech",
    icon: "🔊",
    description: "Convert text to audio"
  },
  stt: {
    label: "Speech-to-Text",
    icon: "🎤",
    description: "Convert audio to text"
  },
  image: {
    label: "Image Generation",
    icon: "🎨",
    description: "Generate images from text"
  },
  vision: {
    label: "Vision",
    icon: "👁️",
    description: "Analyze and understand images"
  },
  video: {
    label: "Video",
    icon: "🎬",
    description: "Video generation and analysis"
  },
  web_search: {
    label: "Web Search",
    icon: "🔍",
    description: "Search the web for information"
  },
  web_fetch: {
    label: "Web Fetch",
    icon: "🌐",
    description: "Fetch and analyze web content"
  }
};

// Auth Type Definitions
export const AUTH_TYPES: Record<ProviderAuthType, { label: string; description: string; complexity: number }> = {
  oauth: {
    label: "OAuth",
    description: "Secure OAuth authentication flow",
    complexity: 2
  },
  api_key: {
    label: "API Key",
    description: "Simple API key authentication",
    complexity: 1
  },
  browser_cookie: {
    label: "Browser Cookie",
    description: "Extract session from browser",
    complexity: 3
  },
  local_cli: {
    label: "Local CLI",
    description: "Use local CLI authentication",
    complexity: 4
  },
  none: {
    label: "None",
    description: "No authentication required",
    complexity: 0
  }
};

// Provider Catalog
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // Subscription Tier
  {
    id: "claude-code",
    name: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's official CLI for Claude with high quotas",
    tier: "subscription",
    serviceKinds: ["chat", "vision"],
    authTypes: ["oauth", "api_key"],
    preferredAuthType: "oauth",
    defaultBaseUrl: "https://api.anthropic.com",
    signupUrl: "https://claude.ai/code",
    docsUrl: "https://docs.anthropic.com/claude/docs/claude-code",
    defaultModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    estimatedSetupTime: "2 minutes",
    popularity: 5
  },
  {
    id: "openai-codex",
    name: "openai-codex",
    displayName: "OpenAI Codex",
    description: "OpenAI's premium API with GPT-4 and advanced models",
    tier: "subscription",
    serviceKinds: ["chat", "embedding", "tts", "stt", "image", "vision"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.openai.com/v1",
    signupUrl: "https://platform.openai.com/signup",
    docsUrl: "https://platform.openai.com/docs",
    defaultModels: ["gpt-4-turbo", "gpt-4o", "gpt-3.5-turbo"],
    estimatedSetupTime: "3 minutes",
    popularity: 5
  },
  {
    id: "gemini-pro",
    name: "gemini-pro",
    displayName: "Gemini Pro",
    description: "Google's premium Gemini models with high quotas",
    tier: "subscription",
    serviceKinds: ["chat", "vision", "embedding"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    signupUrl: "https://makersuite.google.com/",
    docsUrl: "https://ai.google.dev/docs",
    defaultModels: ["gemini-1.5-pro", "gemini-1.5-flash"],
    estimatedSetupTime: "3 minutes",
    popularity: 4
  },
  {
    id: "github-copilot",
    name: "github-copilot",
    displayName: "GitHub Copilot",
    description: "GitHub's AI coding assistant with chat capabilities",
    tier: "subscription",
    serviceKinds: ["chat"],
    authTypes: ["oauth", "local_cli"],
    preferredAuthType: "oauth",
    defaultBaseUrl: "https://api.github.com",
    signupUrl: "https://github.com/features/copilot",
    docsUrl: "https://docs.github.com/en/copilot",
    defaultModels: ["gpt-4", "gpt-3.5-turbo"],
    estimatedSetupTime: "5 minutes",
    popularity: 4
  },
  {
    id: "cursor-pro",
    name: "cursor-pro",
    displayName: "Cursor Pro",
    description: "Cursor's premium AI coding models",
    tier: "subscription",
    serviceKinds: ["chat"],
    authTypes: ["api_key", "oauth"],
    preferredAuthType: "oauth",
    defaultBaseUrl: "https://api.cursor.sh",
    signupUrl: "https://cursor.sh/",
    docsUrl: "https://docs.cursor.sh/",
    defaultModels: ["cursor-fast", "cursor-smart"],
    estimatedSetupTime: "3 minutes",
    popularity: 3
  },
  {
    id: "kiro-ide",
    name: "kiro-ide",
    displayName: "Kiro IDE",
    description: "Kiro's integrated development environment AI",
    tier: "subscription",
    serviceKinds: ["chat", "vision"],
    authTypes: ["oauth"],
    preferredAuthType: "oauth",
    defaultBaseUrl: "https://codewhisperer.us-east-1.amazonaws.com",
    signupUrl: "https://kiro.ai/",
    docsUrl: "https://docs.kiro.ai/",
    riskNotice: {
      level: "medium",
      title: "Subscription Usage Notice",
      message: "This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.",
      learnMoreUrl: "https://docs.kiro.ai/terms"
    },
    defaultModels: ["kr/claude-sonnet-4.6", "kr/claude-opus-4.8"],
    estimatedSetupTime: "4 minutes",
    popularity: 3
  },

  // Cheap Tier
  {
    id: "glm",
    name: "glm",
    displayName: "GLM (Zhipu AI)",
    description: "Cost-effective Chinese AI models with good performance",
    tier: "cheap",
    serviceKinds: ["chat", "embedding", "image"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    signupUrl: "https://open.bigmodel.cn/",
    docsUrl: "https://open.bigmodel.cn/dev/api",
    defaultModels: ["glm-4", "glm-4v", "glm-3-turbo"],
    estimatedSetupTime: "4 minutes",
    popularity: 4
  },
  {
    id: "minimax",
    name: "minimax",
    displayName: "MiniMax",
    description: "Affordable Chinese AI models with multimodal support",
    tier: "cheap",
    serviceKinds: ["chat", "tts", "image"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    signupUrl: "https://www.minimaxi.com/",
    docsUrl: "https://www.minimaxi.com/document/guides/chat-model/pro/api",
    defaultModels: ["abab6.5s-chat", "abab6.5-chat"],
    estimatedSetupTime: "5 minutes",
    popularity: 3
  },
  {
    id: "kimi",
    name: "kimi",
    displayName: "Kimi (Moonshot AI)",
    description: "Long-context Chinese AI models at competitive prices",
    tier: "cheap",
    serviceKinds: ["chat"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    signupUrl: "https://platform.moonshot.cn/",
    docsUrl: "https://platform.moonshot.cn/docs",
    defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    estimatedSetupTime: "4 minutes",
    popularity: 4
  },
  {
    id: "deepseek",
    name: "deepseek",
    displayName: "DeepSeek",
    description: "High-performance coding and reasoning models at low cost",
    tier: "cheap",
    serviceKinds: ["chat"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.deepseek.com",
    signupUrl: "https://platform.deepseek.com/",
    docsUrl: "https://platform.deepseek.com/api-docs",
    defaultModels: ["deepseek-chat", "deepseek-coder"],
    estimatedSetupTime: "3 minutes",
    popularity: 5
  },
  {
    id: "groq",
    name: "groq",
    displayName: "Groq",
    description: "Ultra-fast inference with competitive pricing",
    tier: "cheap",
    serviceKinds: ["chat"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    signupUrl: "https://console.groq.com/",
    docsUrl: "https://console.groq.com/docs",
    defaultModels: ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"],
    estimatedSetupTime: "2 minutes",
    popularity: 4
  },
  {
    id: "xai",
    name: "xai",
    displayName: "xAI (Grok)",
    description: "Elon Musk's xAI with Grok models",
    tier: "cheap",
    serviceKinds: ["chat"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.xai.com/v1",
    signupUrl: "https://x.ai/",
    docsUrl: "https://docs.x.ai/",
    defaultModels: ["grok-beta", "grok-vision-beta"],
    estimatedSetupTime: "4 minutes",
    popularity: 3
  },
  {
    id: "mistral",
    name: "mistral",
    displayName: "Mistral AI",
    description: "European AI models with strong performance and fair pricing",
    tier: "cheap",
    serviceKinds: ["chat", "embedding"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    signupUrl: "https://console.mistral.ai/",
    docsUrl: "https://docs.mistral.ai/",
    defaultModels: ["mistral-large-latest", "mistral-small-latest"],
    estimatedSetupTime: "3 minutes",
    popularity: 4
  },
  {
    id: "openrouter",
    name: "openrouter",
    displayName: "OpenRouter",
    description: "Access to multiple AI models through a single API",
    tier: "cheap",
    serviceKinds: ["chat", "image", "vision"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    signupUrl: "https://openrouter.ai/",
    docsUrl: "https://openrouter.ai/docs",
    defaultModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4-turbo"],
    estimatedSetupTime: "2 minutes",
    popularity: 4
  },

  // Free Tier
  {
    id: "iflow",
    name: "iflow",
    displayName: "iFlow",
    description: "Free AI models with basic quotas for testing",
    tier: "free",
    serviceKinds: ["chat"],
    authTypes: ["api_key", "none"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.iflow.ai/v1",
    signupUrl: "https://iflow.ai/",
    docsUrl: "https://docs.iflow.ai/",
    defaultModels: ["iflow-chat", "iflow-fast"],
    estimatedSetupTime: "2 minutes",
    popularity: 3
  },
  {
    id: "qwen",
    name: "qwen",
    displayName: "Qwen (Alibaba)",
    description: "Alibaba's free AI models with decent performance",
    tier: "free",
    serviceKinds: ["chat", "vision"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    signupUrl: "https://dashscope.aliyun.com/",
    docsUrl: "https://help.aliyun.com/zh/dashscope/",
    defaultModels: ["qwen-turbo", "qwen-plus"],
    estimatedSetupTime: "5 minutes",
    popularity: 3
  },
  {
    id: "kiro-free",
    name: "kiro-free",
    displayName: "Kiro Free",
    description: "Free tier of Kiro AI with limited quotas",
    tier: "free",
    serviceKinds: ["chat"],
    authTypes: ["oauth", "browser_cookie"],
    preferredAuthType: "oauth",
    defaultBaseUrl: "https://codewhisperer.us-east-1.amazonaws.com",
    signupUrl: "https://kiro.ai/",
    docsUrl: "https://docs.kiro.ai/",
    riskNotice: {
      level: "high",
      title: "Free Account Usage Notice",
      message: "This provider uses a free account not intended for proxy/router use. High risk of account restrictions or bans. Use only for testing.",
      learnMoreUrl: "https://docs.kiro.ai/terms"
    },
    defaultModels: ["kr/claude-haiku-3.5", "kr/gpt-3.5-turbo"],
    estimatedSetupTime: "3 minutes",
    popularity: 2
  },
  {
    id: "opencode",
    name: "opencode",
    displayName: "OpenCode",
    description: "Free coding-focused AI models",
    tier: "free",
    serviceKinds: ["chat"],
    authTypes: ["api_key", "none"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.opencode.ai/v1",
    signupUrl: "https://opencode.ai/",
    docsUrl: "https://docs.opencode.ai/",
    defaultModels: ["opencode-chat", "opencode-instruct"],
    estimatedSetupTime: "3 minutes",
    popularity: 2
  },
  {
    id: "gemini-free",
    name: "gemini-free",
    displayName: "Gemini Free",
    description: "Google's free Gemini models with rate limits",
    tier: "free",
    serviceKinds: ["chat", "vision"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    signupUrl: "https://makersuite.google.com/",
    docsUrl: "https://ai.google.dev/docs",
    defaultModels: ["gemini-1.5-flash", "gemini-1.0-pro"],
    estimatedSetupTime: "3 minutes",
    popularity: 4
  },
  {
    id: "cloudflare-ai",
    name: "cloudflare-ai",
    displayName: "Cloudflare AI",
    description: "Cloudflare's free AI models on Workers platform",
    tier: "free",
    serviceKinds: ["chat", "embedding", "image"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://api.cloudflare.com/client/v4",
    signupUrl: "https://dash.cloudflare.com/",
    docsUrl: "https://developers.cloudflare.com/workers-ai/",
    defaultModels: ["@cf/meta/llama-3.1-8b-instruct", "@cf/microsoft/phi-2"],
    estimatedSetupTime: "4 minutes",
    popularity: 3
  },
  {
    id: "nvidia-nim",
    name: "nvidia-nim",
    displayName: "NVIDIA NIM",
    description: "NVIDIA's free inference microservices",
    tier: "free",
    serviceKinds: ["chat", "embedding"],
    authTypes: ["api_key"],
    preferredAuthType: "api_key",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    signupUrl: "https://build.nvidia.com/",
    docsUrl: "https://docs.nvidia.com/nim/",
    defaultModels: ["nvidia/llama-3.1-nemotron-70b-instruct"],
    estimatedSetupTime: "5 minutes",
    popularity: 3
  }
];

// Utility Functions
export function getProvidersByTier(tier: ProviderTier): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter(provider => provider.tier === tier)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function getProviderById(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find(provider => provider.id === id);
}

export function getProvidersByServiceKind(serviceKind: ProviderServiceKind): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter(provider =>
    provider.serviceKinds.includes(serviceKind)
  ).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function getProvidersByAuthType(authType: ProviderAuthType): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter(provider =>
    provider.authTypes.includes(authType)
  ).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function getRecommendedProviders(limit: number = 5): ProviderCatalogEntry[] {
  return PROVIDER_CATALOG
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, limit);
}

export function getTierSummary(): Record<ProviderTier, { count: number; label: string; description: string }> {
  const summary: Record<ProviderTier, { count: number; label: string; description: string }> = {
    subscription: { count: 0, ...PROVIDER_TIERS.subscription },
    cheap: { count: 0, ...PROVIDER_TIERS.cheap },
    free: { count: 0, ...PROVIDER_TIERS.free },
    custom: { count: 0, ...PROVIDER_TIERS.custom }
  };

  PROVIDER_CATALOG.forEach(provider => {
    summary[provider.tier].count++;
  });

  return summary;
}