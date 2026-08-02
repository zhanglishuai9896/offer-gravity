const TYPE_PROFILES = {
  ISTJ: ["秩序执行者", ["财务审计", "质量管理", "供应链计划", "合规风控", "项目运营"], ["规则清晰", "职责稳定", "可验证成果"], ["可靠严谨", "持续执行", "风险意识"]],
  ISFJ: ["细致守护者", ["人力资源", "客户成功", "医疗护理", "教育支持", "行政运营"], ["重视协作", "服务价值明确", "节奏可预期"], ["体察需求", "耐心负责", "细节稳定"]],
  INFJ: ["洞察引导者", ["用户研究", "心理与社会服务", "品牌策略", "内容策划", "组织发展"], ["使命感明确", "允许深度思考", "尊重长期价值"], ["洞察关系", "整合复杂信息", "长期思考"]],
  INTJ: ["系统建筑师", ["战略规划", "数据分析", "产品策略", "研发架构", "投资研究"], ["高度自主", "复杂问题", "看重专业判断"], ["系统设计", "独立推演", "长期规划"]],
  ISTP: ["冷静解题者", ["工程技术", "运维安全", "产品测试", "工业设计", "技术支持"], ["问题具体", "自主空间", "减少无效会议"], ["临场判断", "动手验证", "故障排查"]],
  ISFP: ["体验创作者", ["视觉设计", "空间与陈列", "健康照护", "内容创作", "体验运营"], ["尊重个体", "审美与体验价值", "氛围友好"], ["感知细腻", "灵活适应", "真实表达"]],
  INFP: ["价值探索者", ["内容创作", "编辑出版", "公益项目", "品牌内容", "用户研究"], ["价值观一致", "表达空间", "低内耗协作"], ["同理心", "意义驱动", "创意联想"]],
  INTP: ["逻辑探索者", ["算法研发", "数据科学", "策略研究", "产品分析", "技术写作"], ["智力挑战", "低层级干预", "允许试验"], ["抽象建模", "逻辑拆解", "探索未知"]],
  ESTP: ["行动破局者", ["商务拓展", "销售顾问", "活动运营", "应急管理", "创业业务"], ["反馈快速", "目标明确", "现场决策"], ["快速行动", "谈判影响", "机会捕捉"]],
  ESFP: ["现场连接者", ["品牌活动", "新媒体运营", "客户体验", "零售管理", "培训主持"], ["互动丰富", "反馈及时", "氛围开放"], ["感染他人", "现场反应", "体验营造"]],
  ENFP: ["灵感推动者", ["品牌营销", "创意策划", "产品创新", "社区运营", "人才发展"], ["变化与探索", "跨团队连接", "允许发起新事物"], ["激发可能", "沟通连接", "创意发散"]],
  ENTP: ["创新辩证者", ["产品经理", "战略咨询", "增长营销", "创业创新", "商业分析"], ["高变化", "允许挑战假设", "以结果而非流程衡量"], ["快速建模", "观点碰撞", "方案创新"]],
  ESTJ: ["目标管理者", ["运营管理", "项目管理", "供应链管理", "销售管理", "生产管理"], ["权责明确", "目标量化", "执行效率高"], ["组织推进", "资源协调", "决策果断"]],
  ESFJ: ["协作组织者", ["客户成功", "人力资源", "教育培训", "公关活动", "门店运营"], ["团队关系稳定", "服务对象明确", "认可及时"], ["关系维护", "流程协调", "责任投入"]],
  ENFJ: ["成长引领者", ["团队管理", "组织发展", "教育培训", "品牌公关", "咨询顾问"], ["能影响他人", "共同目标", "重视成长反馈"], ["激励沟通", "识别人心", "推动共识"]],
  ENTJ: ["战略推进者", ["经营管理", "战略咨询", "产品负责人", "投融资", "业务拓展"], ["决策空间", "高目标挑战", "资源可调度"], ["战略判断", "统筹资源", "推进结果"]],
};

const DIMENSIONS = [
  { key: "EI", left: "E", right: "I", leftLabel: "外向 E", rightLabel: "内向 I" },
  { key: "SN", left: "S", right: "N", leftLabel: "实感 S", rightLabel: "直觉 N" },
  { key: "TF", left: "T", right: "F", leftLabel: "思考 T", rightLabel: "情感 F" },
  { key: "JP", left: "J", right: "P", leftLabel: "判断 J", rightLabel: "感知 P" },
];

export function analyzeMbti(answers = {}) {
  const scores = { EI: 0, SN: 0, TF: 0, JP: 0 };
  for (let index = 1; index <= 20; index += 1) {
    const dimension = DIMENSIONS[Math.floor((index - 1) / 5)];
    const value = Number(answers[`q${index}`]);
    if (!Number.isFinite(value) || value < -2 || value > 2) throw new Error("请完成全部 20 道 MBTI 题目");
    scores[dimension.key] += value;
  }

  const letters = DIMENSIONS.map((dimension) => scores[dimension.key] > 0 ? dimension.right : dimension.left);
  const type = letters.join("");
  const profile = TYPE_PROFILES[type];
  const dimensions = DIMENSIONS.map((dimension) => {
    const raw = scores[dimension.key];
    const rightPercent = Math.round(50 + raw * 5);
    return { key: dimension.key, left: dimension.leftLabel, right: dimension.rightLabel, rightPercent, preference: raw > 0 ? dimension.right : dimension.left };
  });

  return {
    type,
    title: profile[0],
    summary: `${type} 更倾向以${letters[0] === "E" ? "互动" : "独处"}恢复精力、关注${letters[1] === "S" ? "事实与经验" : "可能性与规律"}，做决定时更重视${letters[2] === "T" ? "逻辑一致" : "关系与价值"}，工作节奏偏向${letters[3] === "J" ? "计划和确定" : "弹性与探索"}。`,
    dimensions,
    recommendedRoles: profile[1],
    suitableEnvironments: profile[2],
    strengths: profile[3],
    cautions: ["MBTI 只描述偏好，不代表能力高低", "岗位选择还需结合经验、技能、城市和真实机会", "同一类型在不同经历与环境下可能表现不同"],
    analyzedAt: new Date().toISOString(),
  };
}
