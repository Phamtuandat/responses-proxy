import { z } from "zod";

const passthroughRecordSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

const inputTextPartSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

const inputImagePartSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string().min(1),
});

const outputTextPartSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
});

const contentPartSchema = z.union([
  inputTextPartSchema,
  inputImagePartSchema,
  outputTextPartSchema,
]);

const imageUrlValueSchema = z.union([
  z.string().min(1),
  z.object({
    url: z.string().min(1),
  }),
]);

const chatTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const chatImagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: imageUrlValueSchema,
});

const chatContentPartSchema = z.union([chatTextPartSchema, chatImagePartSchema]);

const assistantToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "developer", "tool"]),
  content: z.union([z.string(), z.array(chatContentPartSchema)]).optional(),
  tool_calls: z.array(assistantToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

const inputItemSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.union([z.string(), z.array(contentPartSchema)]),
});

const functionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().optional(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
  function: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
      strict: z.boolean().optional(),
    })
    .optional(),
});

const passthroughToolSchema = passthroughRecordSchema;

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  passthroughRecordSchema,
]);

const reasoningSchema = z.object({
  effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  summary: z.enum(["auto", "none", "concise", "detailed"]).optional(),
});

const textSchema = z.object({
  verbosity: z.enum(["low", "medium", "high"]).optional(),
  format: passthroughRecordSchema.optional(),
});

export const proxyResponsesRequestSchema = z
  .object({
    model: z.string().min(1),
    input: z
      .union([z.string(), z.array(z.union([inputItemSchema, passthroughRecordSchema]))])
      .optional(),
    messages: z.array(messageSchema).optional(),
    instructions: z.string().optional(),
    store: z.boolean().optional(),
    stream: z.boolean().optional(),
    tools: z.array(z.union([functionToolSchema, passthroughToolSchema])).optional(),
    tool_choice: toolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    reasoning: reasoningSchema.optional(),
    text: textSchema.optional(),
    max_output_tokens: z.number().int().positive().optional(),
    max_tool_calls: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    user: z.string().optional(),
    previous_response_id: z.string().optional(),
    truncation: z.enum(["auto", "disabled"]).optional(),
    include: z.array(z.string()).optional(),
    prompt_cache_key: z.string().optional(),
    prompt_cache_retention: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.input === undefined && value.messages === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input"],
        message: "Either input or messages must be provided",
      });
    }
  });

export type ProxyResponsesRequest = z.infer<typeof proxyResponsesRequestSchema>;
