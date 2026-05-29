export const DISTILL_PROMPTS = {
  expressionDNA: `你是一个专业的语言风格分析师。请分析以下聊天记录中"我方"的表达特征，提取出表达DNA。

请从以下维度分析：
1. 语气特征：日常语气、情绪化表达、反讽使用等
2. 词汇偏好：高频词汇、口头禅、网络用语、专业术语等
3. 句式特点：长句/短句偏好、反问句使用、省略句使用等
4. 表情/符号使用：emoji偏好、标点符号使用习惯等
5. 话题转换方式：如何开始新话题、如何结束话题等

聊天记录：
{chatRecords}

请以JSON格式输出分析结果，包含以下字段：
- tone: 语气特征描述
- vocabulary: 常用词汇列表
- sentencePatterns: 句式特点列表
- emojiUsage: 表情使用习惯描述
- topicTransition: 话题转换方式描述`,

  mentalModels: `你是一个专业的思维模式分析师。请分析以下聊天记录中"我方"的思维模式，提取出心智模型。

请从以下维度分析：
1. 推理方式：演绎/归纳偏好、类比思维使用等
2. 决策模式：快速决策/深思熟虑、风险偏好等
3. 问题解决策略：系统性/直觉性、分解/整体等
4. 信息处理偏好：细节导向/全局导向、数据驱动/经验驱动等
5. 创造性思维：发散/收敛、联想模式等

聊天记录：
{chatRecords}

请以JSON格式输出分析结果，包含以下字段：
- reasoningStyle: 推理方式描述
- decisionPattern: 决策模式描述
- problemSolving: 问题解决策略描述
- infoProcessing: 信息处理偏好描述
- creativity: 创造性思维描述`,

  decisionHeuristics: `你是一个专业的决策分析专家。请分析以下聊天记录中"我方"的决策启发式规则，提取出决策启发式。

请从以下维度分析：
1. 快速判断规则：在什么情况下倾向于快速做出判断
2. 权衡取舍模式：面对冲突时如何取舍
3. 风险评估方式：如何评估和应对风险
4. 优先级排序：如何排列不同事项的优先级
5. 回避策略：倾向于回避什么样的决策或情境

聊天记录：
{chatRecords}

请以JSON格式输出分析结果，包含以下字段：
- quickJudgment: 快速判断规则列表
- tradeoffPattern: 权衡取舍模式描述
- riskAssessment: 风险评估方式描述
- prioritization: 优先级排序规则列表
- avoidanceStrategies: 回避策略列表`,

  valuesAndAntiPatterns: `你是一个专业的价值观分析专家。请分析以下聊天记录中"我方"的价值观和反模式，提取出核心价值观和反模式。

请从以下维度分析：
1. 核心价值观：最看重的价值原则
2. 底线与禁忌：绝对不能接受的事物
3. 反模式：反复出现的不良行为模式
4. 自我矛盾：言行不一致的地方
5. 防御机制：面对压力时的典型反应

聊天记录：
{chatRecords}

请以JSON格式输出分析结果，包含以下字段：
- coreValues: 核心价值观列表
- taboos: 底线与禁忌列表
- antiPatterns: 反模式列表
- contradictions: 自我矛盾列表
- defenseMechanisms: 防御机制列表`,

  honestyBoundaries: `你是一个专业的真诚度分析专家。请分析以下聊天记录中"我方"的真诚边界，提取出诚实度边界。

请从以下维度分析：
1. 坦诚程度：在什么话题上最坦诚，在什么话题上有所保留
2. 谎言模式：是否存在善意的谎言，在什么情况下使用
3. 回避话题：倾向于回避哪些话题
4. 情绪表达真实性：情绪表达是否真实，是否有表演成分
5. 承诺可信度：做出的承诺是否可靠

聊天记录：
{chatRecords}

请以JSON格式输出分析结果，包含以下字段：
- openness: 坦诚程度描述
- whiteLies: 善意谎言使用场景列表
- avoidedTopics: 回避话题列表
- emotionalAuthenticity: 情绪表达真实性描述
- commitmentReliability: 承诺可信度描述`,

  validation: `你是一个专业的角色验证专家。请验证以下蒸馏出的角色特征是否准确、一致、可用。

角色特征摘要：
{skillSummary}

原始聊天记录样本：
{chatRecordsSample}

请从以下维度验证：
1. 一致性：各维度特征之间是否存在矛盾
2. 准确性：特征是否与聊天记录一致
3. 完整性：是否遗漏了重要特征
4. 可用性：特征是否足够具体，能否用于生成回复
5. 安全性：是否包含不当内容或偏见

请以JSON格式输出验证结果，包含以下字段：
- consistencyScore: 一致性评分(0-1)
- accuracyScore: 准确性评分(0-1)
- completenessScore: 完整性评分(0-1)
- usabilityScore: 可用性评分(0-1)
- safetyScore: 安全性评分(0-1)
- issues: 发现的问题列表
- suggestions: 改进建议列表`
}
