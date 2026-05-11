export type ModelRoutingPolicy = {
  enabled: boolean;
  inputTokenThreshold: number;
  cheapModel: string;
  skipIfTools: boolean;
  skipIfImages: boolean;
  skipIfReasoning: boolean;
};

export type ModelRoutingDecision =
  | { downgraded: true; originalModel: string; resolvedModel: string; reason: string }
  | { downgraded: false };

export function resolveModelRouting(
  requestBody: Record<string, unknown>,
  policy: ModelRoutingPolicy,
): ModelRoutingDecision {
  if (!policy.enabled) {
    return { downgraded: false };
  }

  const model = typeof requestBody.model === "string" ? requestBody.model : "";
  const isExpensiveModel = /gpt-4|o1|o3|claude-3-5|claude-opus/i.test(model);
  if (!isExpensiveModel) {
    return { downgraded: false };
  }

  if (policy.skipIfTools && Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    return { downgraded: false };
  }

  if (policy.skipIfReasoning && requestBody.reasoning !== undefined) {
    return { downgraded: false };
  }

  if (policy.skipIfImages && hasImageInput(requestBody)) {
    return { downgraded: false };
  }

  const estimatedTokens = estimateInputTokens(requestBody);
  if (estimatedTokens > policy.inputTokenThreshold) {
    return { downgraded: false };
  }

  return {
    downgraded: true,
    originalModel: model,
    resolvedModel: policy.cheapModel,
    reason: `estimated_tokens:${estimatedTokens}<threshold:${policy.inputTokenThreshold}`,
  };
}

function estimateInputTokens(body: Record<string, unknown>): number {
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const input = Array.isArray(body.input) ? body.input : [];
  const inputText = input
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return typeof item === "string" ? item : "";
      }
      const content = (item as Record<string, unknown>).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) =>
            typeof part === "object" && part !== null
              ? String((part as Record<string, unknown>).text ?? "")
              : "",
          )
          .join(" ");
      }
      return "";
    })
    .join(" ");

  return Math.ceil((instructions.length + inputText.length) / 4);
}

function hasImageInput(body: Record<string, unknown>): boolean {
  const input = Array.isArray(body.input) ? body.input : [];
  return input.some((item) => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      return false;
    }
    return content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        ((part as Record<string, unknown>).type === "image_url" ||
          (part as Record<string, unknown>).type === "input_image"),
    );
  });
}
