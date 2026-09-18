/**
 * Devin / Cascade protobuf 子集：只保留登录后模型发现与聊天流实际读写的字段。
 * 字段号对齐 oh-my-pi 生成的 devin-proto（未知字段由 codec 跳过）。
 */
import {
  create,
  fromBinary,
  type MessageCodec,
  type ProtoMessage,
  pb,
  toBinary,
} from './vendor/protobuf';

export { create, fromBinary, toBinary };

export enum CacheControlType {
  UNSPECIFIED = 0,
  EPHEMERAL = 1,
}

export enum ChatMessageRequestType {
  UNSPECIFIED = 0,
  CASCADE = 5,
}

export enum ChatMessageSource {
  UNSPECIFIED = 0,
  USER = 1,
  SYSTEM = 2,
  TOOL = 4,
}

export enum ConversationalPlannerMode {
  UNSPECIFIED = 0,
  DEFAULT = 1,
}

export enum StopReason {
  UNSPECIFIED = 0,
  MAX_TOKENS = 3,
}

export interface ImageData extends ProtoMessage {
  base64Data: string;
  mimeType: string;
}

export const ImageDataSchema: MessageCodec<ImageData> = pb<ImageData>(
  'exa.codeium_common_pb.ImageData',
  [
    { no: 1, name: 'base64Data', kind: 'string' },
    { no: 2, name: 'mimeType', kind: 'string' },
  ]
);

export interface ChatToolCall extends ProtoMessage {
  id: string;
  name: string;
  argumentsJson: string;
}

export const ChatToolCallSchema: MessageCodec<ChatToolCall> = pb<ChatToolCall>(
  'exa.codeium_common_pb.ChatToolCall',
  [
    { no: 1, name: 'id', kind: 'string' },
    { no: 2, name: 'name', kind: 'string' },
    { no: 3, name: 'argumentsJson', kind: 'string' },
  ]
);

export interface ChatToolChoice extends ProtoMessage {
  choice:
    | { case: undefined; value?: undefined }
    | { case: 'optionName'; value: string }
    | { case: 'toolName'; value: string };
}

export const ChatToolChoiceSchema: MessageCodec<ChatToolChoice> = pb<ChatToolChoice>(
  'exa.chat_pb.ChatToolChoice',
  [
    {
      kind: 'oneof',
      name: 'choice',
      variants: [
        { no: 1, name: 'optionName', kind: 'string' },
        { no: 2, name: 'toolName', kind: 'string' },
      ],
    },
  ]
);

export interface ChatToolDefinition extends ProtoMessage {
  name: string;
  description: string;
  jsonSchemaString: string;
  strict: boolean;
}

export const ChatToolDefinitionSchema: MessageCodec<ChatToolDefinition> = pb<ChatToolDefinition>(
  'exa.chat_pb.ChatToolDefinition',
  [
    { no: 1, name: 'name', kind: 'string' },
    { no: 2, name: 'description', kind: 'string' },
    { no: 3, name: 'jsonSchemaString', kind: 'string' },
    { no: 12, name: 'strict', kind: 'bool' },
  ]
);

export interface PromptCacheOptions extends ProtoMessage {
  type: CacheControlType;
}

export const PromptCacheOptionsSchema: MessageCodec<PromptCacheOptions> = pb<PromptCacheOptions>(
  'exa.chat_pb.PromptCacheOptions',
  [{ no: 1, name: 'type', kind: 'enum' }]
);

export interface ChatMessagePrompt extends ProtoMessage {
  messageId: string;
  source: ChatMessageSource;
  prompt: string;
  toolCalls: ChatToolCall[];
  toolCallId: string;
  toolResultIsError: boolean;
  images: ImageData[];
  thinking: string;
  signature: string;
  signatureType: string;
}

export const ChatMessagePromptSchema: MessageCodec<ChatMessagePrompt> = pb<ChatMessagePrompt>(
  'exa.chat_pb.ChatMessagePrompt',
  [
    { no: 1, name: 'messageId', kind: 'string' },
    { no: 2, name: 'source', kind: 'enum' },
    { no: 3, name: 'prompt', kind: 'string' },
    { no: 6, name: 'toolCalls', kind: 'message', T: () => ChatToolCallSchema, repeat: true },
    { no: 7, name: 'toolCallId', kind: 'string' },
    { no: 9, name: 'toolResultIsError', kind: 'bool' },
    { no: 10, name: 'images', kind: 'message', T: () => ImageDataSchema, repeat: true },
    { no: 11, name: 'thinking', kind: 'string' },
    { no: 12, name: 'signature', kind: 'string' },
    { no: 18, name: 'signatureType', kind: 'string' },
  ]
);

export interface CompletionConfiguration extends ProtoMessage {
  numCompletions: bigint;
  maxTokens: bigint;
  maxNewlines: bigint;
  temperature: number;
  firstTemperature: number;
  topK: bigint;
  topP: number;
  stopPatterns: string[];
  fimEotProbThreshold: number;
}

export const CompletionConfigurationSchema: MessageCodec<CompletionConfiguration> =
  pb<CompletionConfiguration>('exa.codeium_common_pb.CompletionConfiguration', [
    { no: 1, name: 'numCompletions', kind: 'uint64' },
    { no: 2, name: 'maxTokens', kind: 'uint64' },
    { no: 3, name: 'maxNewlines', kind: 'uint64' },
    { no: 5, name: 'temperature', kind: 'double' },
    { no: 6, name: 'firstTemperature', kind: 'double' },
    { no: 7, name: 'topK', kind: 'uint64' },
    { no: 8, name: 'topP', kind: 'double' },
    { no: 9, name: 'stopPatterns', kind: 'string', repeat: true },
    { no: 11, name: 'fimEotProbThreshold', kind: 'double' },
  ]);

export interface Metadata extends ProtoMessage {
  ideName: string;
  ideVersion: string;
  extensionName: string;
  extensionVersion: string;
  apiKey: string;
  locale: string;
  userJwt: string;
}

export const MetadataSchema: MessageCodec<Metadata> = pb<Metadata>(
  'exa.codeium_common_pb.Metadata',
  [
    { no: 1, name: 'ideName', kind: 'string' },
    { no: 7, name: 'ideVersion', kind: 'string' },
    { no: 12, name: 'extensionName', kind: 'string' },
    { no: 2, name: 'extensionVersion', kind: 'string' },
    { no: 3, name: 'apiKey', kind: 'string' },
    { no: 4, name: 'locale', kind: 'string' },
    { no: 21, name: 'userJwt', kind: 'string' },
  ]
);

export interface ModelFeatures extends ProtoMessage {
  supportsThinking: boolean;
}

export const ModelFeaturesSchema: MessageCodec<ModelFeatures> = pb<ModelFeatures>(
  'exa.codeium_common_pb.ModelFeatures',
  [{ no: 15, name: 'supportsThinking', kind: 'bool' }]
);

export interface ModelInfo extends ProtoMessage {
  modelFeatures?: ModelFeatures;
}

export const ModelInfoSchema: MessageCodec<ModelInfo> = pb<ModelInfo>(
  'exa.codeium_common_pb.ModelInfo',
  [{ no: 6, name: 'modelFeatures', kind: 'message', T: () => ModelFeaturesSchema }]
);

export interface ClientModelConfig extends ProtoMessage {
  label: string;
  modelUid: string;
  disabled: boolean;
  supportsImages: boolean;
  maxTokens: number;
  modelInfo?: ModelInfo;
}

export const ClientModelConfigSchema: MessageCodec<ClientModelConfig> = pb<ClientModelConfig>(
  'exa.codeium_common_pb.ClientModelConfig',
  [
    { no: 1, name: 'label', kind: 'string' },
    { no: 22, name: 'modelUid', kind: 'string' },
    { no: 4, name: 'disabled', kind: 'bool' },
    { no: 5, name: 'supportsImages', kind: 'bool' },
    { no: 18, name: 'maxTokens', kind: 'int32' },
    { no: 23, name: 'modelInfo', kind: 'message', T: () => ModelInfoSchema },
  ]
);

export interface ModelUsageStats extends ProtoMessage {
  inputTokens: bigint;
  outputTokens: bigint;
  cacheWriteTokens: bigint;
  cacheReadTokens: bigint;
}

export const ModelUsageStatsSchema: MessageCodec<ModelUsageStats> = pb<ModelUsageStats>(
  'exa.codeium_common_pb.ModelUsageStats',
  [
    { no: 2, name: 'inputTokens', kind: 'uint64' },
    { no: 3, name: 'outputTokens', kind: 'uint64' },
    { no: 4, name: 'cacheWriteTokens', kind: 'uint64' },
    { no: 5, name: 'cacheReadTokens', kind: 'uint64' },
  ]
);

export interface GetCliModelConfigsRequest extends ProtoMessage {
  metadata?: Metadata;
}

export const GetCliModelConfigsRequestSchema: MessageCodec<GetCliModelConfigsRequest> =
  pb<GetCliModelConfigsRequest>('exa.api_server_pb.GetCliModelConfigsRequest', [
    { no: 1, name: 'metadata', kind: 'message', T: () => MetadataSchema },
  ]);

export interface GetCliModelConfigsResponse extends ProtoMessage {
  clientModelConfigs: ClientModelConfig[];
}

export const GetCliModelConfigsResponseSchema: MessageCodec<GetCliModelConfigsResponse> =
  pb<GetCliModelConfigsResponse>('exa.api_server_pb.GetCliModelConfigsResponse', [
    {
      no: 1,
      name: 'clientModelConfigs',
      kind: 'message',
      T: () => ClientModelConfigSchema,
      repeat: true,
    },
  ]);

export interface GetUserJwtRequest extends ProtoMessage {
  metadata?: Metadata;
}

export const GetUserJwtRequestSchema: MessageCodec<GetUserJwtRequest> = pb<GetUserJwtRequest>(
  'exa.auth_pb.GetUserJwtRequest',
  [{ no: 1, name: 'metadata', kind: 'message', T: () => MetadataSchema }]
);

export interface GetUserJwtResponse extends ProtoMessage {
  userJwt: string;
  customApiServerUrl: string;
}

export const GetUserJwtResponseSchema: MessageCodec<GetUserJwtResponse> = pb<GetUserJwtResponse>(
  'exa.auth_pb.GetUserJwtResponse',
  [
    { no: 1, name: 'userJwt', kind: 'string' },
    { no: 2, name: 'customApiServerUrl', kind: 'string' },
  ]
);

export interface GetChatMessageRequest extends ProtoMessage {
  metadata?: Metadata;
  prompt: string;
  chatMessagePrompts: ChatMessagePrompt[];
  chatModelUid: string;
  requestType: ChatMessageRequestType;
  configuration?: CompletionConfiguration;
  tools: ChatToolDefinition[];
  disableParallelToolCalls: boolean;
  toolChoice?: ChatToolChoice;
  systemPromptCacheOptions?: PromptCacheOptions;
  cascadeId: string;
  plannerMode: ConversationalPlannerMode;
  executionId: string;
}

export const GetChatMessageRequestSchema: MessageCodec<GetChatMessageRequest> =
  pb<GetChatMessageRequest>('exa.api_server_pb.GetChatMessageRequest', [
    { no: 1, name: 'metadata', kind: 'message', T: () => MetadataSchema },
    { no: 2, name: 'prompt', kind: 'string' },
    {
      no: 3,
      name: 'chatMessagePrompts',
      kind: 'message',
      T: () => ChatMessagePromptSchema,
      repeat: true,
    },
    { no: 21, name: 'chatModelUid', kind: 'string' },
    { no: 7, name: 'requestType', kind: 'enum' },
    { no: 8, name: 'configuration', kind: 'message', T: () => CompletionConfigurationSchema },
    { no: 10, name: 'tools', kind: 'message', T: () => ChatToolDefinitionSchema, repeat: true },
    { no: 11, name: 'disableParallelToolCalls', kind: 'bool' },
    { no: 12, name: 'toolChoice', kind: 'message', T: () => ChatToolChoiceSchema },
    {
      no: 13,
      name: 'systemPromptCacheOptions',
      kind: 'message',
      T: () => PromptCacheOptionsSchema,
    },
    { no: 16, name: 'cascadeId', kind: 'string' },
    { no: 20, name: 'plannerMode', kind: 'enum' },
    { no: 22, name: 'executionId', kind: 'string' },
  ]);

export interface GetChatMessageResponse extends ProtoMessage {
  messageId: string;
  deltaText: string;
  stopReason: StopReason;
  deltaToolCalls: ChatToolCall[];
  usage?: ModelUsageStats;
  deltaThinking: string;
  deltaSignature: string;
}

export const GetChatMessageResponseSchema: MessageCodec<GetChatMessageResponse> =
  pb<GetChatMessageResponse>('exa.api_server_pb.GetChatMessageResponse', [
    { no: 1, name: 'messageId', kind: 'string' },
    { no: 3, name: 'deltaText', kind: 'string' },
    { no: 5, name: 'stopReason', kind: 'enum' },
    { no: 6, name: 'deltaToolCalls', kind: 'message', T: () => ChatToolCallSchema, repeat: true },
    { no: 7, name: 'usage', kind: 'message', T: () => ModelUsageStatsSchema },
    { no: 9, name: 'deltaThinking', kind: 'string' },
    { no: 10, name: 'deltaSignature', kind: 'string' },
  ]);

export interface PlanInfo extends ProtoMessage {
  planName: string;
  isDevin: boolean;
  hideDailyQuota: boolean;
  hideWeeklyQuota: boolean;
}

export const PlanInfoSchema: MessageCodec<PlanInfo> = pb<PlanInfo>(
  'exa.codeium_common_pb.PlanInfo',
  [
    { no: 2, name: 'planName', kind: 'string' },
    { no: 34, name: 'isDevin', kind: 'bool' },
    { no: 36, name: 'hideDailyQuota', kind: 'bool' },
    { no: 37, name: 'hideWeeklyQuota', kind: 'bool' },
  ]
);

export interface PlanStatus extends ProtoMessage {
  planInfo?: PlanInfo;
  availableFlexCredits: number;
  usedFlowCredits: number;
  usedPromptCredits: number;
  usedFlexCredits: number;
  availablePromptCredits: number;
  availableFlowCredits: number;
  dailyQuotaRemainingPercent: number;
  weeklyQuotaRemainingPercent: number;
  dailyQuotaResetAtUnix: bigint;
  weeklyQuotaResetAtUnix: bigint;
}

export const PlanStatusSchema: MessageCodec<PlanStatus> = pb<PlanStatus>(
  'exa.codeium_common_pb.PlanStatus',
  [
    { no: 1, name: 'planInfo', kind: 'message', T: () => PlanInfoSchema },
    { no: 4, name: 'availableFlexCredits', kind: 'int32' },
    { no: 5, name: 'usedFlowCredits', kind: 'int32' },
    { no: 6, name: 'usedPromptCredits', kind: 'int32' },
    { no: 7, name: 'usedFlexCredits', kind: 'int32' },
    { no: 8, name: 'availablePromptCredits', kind: 'int32' },
    { no: 9, name: 'availableFlowCredits', kind: 'int32' },
    { no: 14, name: 'dailyQuotaRemainingPercent', kind: 'int32' },
    { no: 15, name: 'weeklyQuotaRemainingPercent', kind: 'int32' },
    { no: 17, name: 'dailyQuotaResetAtUnix', kind: 'int64' },
    { no: 18, name: 'weeklyQuotaResetAtUnix', kind: 'int64' },
  ]
);

export interface UserStatus extends ProtoMessage {
  name: string;
  email: string;
  planStatus?: PlanStatus;
}

export const UserStatusSchema: MessageCodec<UserStatus> = pb<UserStatus>(
  'exa.codeium_common_pb.UserStatus',
  [
    { no: 3, name: 'name', kind: 'string' },
    { no: 7, name: 'email', kind: 'string' },
    { no: 13, name: 'planStatus', kind: 'message', T: () => PlanStatusSchema },
  ]
);

export interface GetUserStatusRequest extends ProtoMessage {
  metadata?: Metadata;
}

export const GetUserStatusRequestSchema: MessageCodec<GetUserStatusRequest> =
  pb<GetUserStatusRequest>('exa.seat_management_pb.GetUserStatusRequest', [
    { no: 1, name: 'metadata', kind: 'message', T: () => MetadataSchema },
  ]);

export interface GetUserStatusResponse extends ProtoMessage {
  userStatus?: UserStatus;
  planInfo?: PlanInfo;
}

export const GetUserStatusResponseSchema: MessageCodec<GetUserStatusResponse> =
  pb<GetUserStatusResponse>('exa.seat_management_pb.GetUserStatusResponse', [
    { no: 1, name: 'userStatus', kind: 'message', T: () => UserStatusSchema },
    { no: 2, name: 'planInfo', kind: 'message', T: () => PlanInfoSchema },
  ]);
