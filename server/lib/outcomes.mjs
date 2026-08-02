const APPLIED = new Set(["已投递", "有效回复", "面试", "拒绝"]);
const REPLIED = new Set(["有效回复", "面试"]);

function percent(value, total) { return total ? Math.round(value / total * 100) : 0; }

function groupPerformance(jobs, keyOf) {
  const groups = new Map();
  for (const job of jobs.filter((item) => APPLIED.has(item.stage))) {
    const key = keyOf(job) || "未分类";
    const item = groups.get(key) || { name: key, applied: 0, replies: 0, interviews: 0 };
    item.applied += 1;
    if (REPLIED.has(job.stage)) item.replies += 1;
    if (job.stage === "面试") item.interviews += 1;
    groups.set(key, item);
  }
  return [...groups.values()].map((item) => ({ ...item, replyRate: percent(item.replies, item.applied), interviewRate: percent(item.interviews, item.applied) })).sort((a, b) => b.replyRate - a.replyRate || b.applied - a.applied);
}

export function analyzeOutcomes(jobs = [], previousReview = null) {
  const appliedJobs = jobs.filter((job) => APPLIED.has(job.stage));
  const replies = appliedJobs.filter((job) => REPLIED.has(job.stage)).length;
  const interviews = appliedJobs.filter((job) => job.stage === "面试").length;
  const metrics = { analyzed: jobs.length, applied: appliedJobs.length, replies, interviews, replyRate: percent(replies, appliedJobs.length), interviewRate: percent(interviews, appliedJobs.length) };
  const byRole = groupPerformance(jobs, (job) => job.title);
  const labels = { platform: "招聘平台", official: "企业官网", email: "招聘邮箱" };
  const byChannel = groupPerformance(jobs, (job) => labels[job.channel] || job.channel || "未分类");
  const diagnosis = [];
  const actions = [];

  if (metrics.applied < 10) {
    diagnosis.push("当前真实投递样本不足，暂时不能用少量结果断定方向或简历存在问题。");
    actions.push(`再完成 ${10 - metrics.applied} 次经过筛选的真实投递，并持续记录已读、回复和面试结果。`);
  } else if (metrics.replyRate < 10) {
    diagnosis.push("有效回复率偏低，优先检查岗位选择、硬条件和简历首屏证据，而不是继续扩大海投量。");
    actions.push("暂停低匹配岗位；只保留 A 类和高分 B 类岗位，针对主投岗位重写简历标题、摘要和前三条成果。");
  } else if (metrics.interviewRate < Math.max(5, Math.round(metrics.replyRate * 0.35))) {
    diagnosis.push("已经获得回复但面试转化偏低，问题更可能出现在沟通确认、经历证明或岗位期望一致性。");
    actions.push("整理三段可核验的项目案例，并在沟通中明确到岗时间、薪资范围和关键能力证据。 ");
  } else {
    diagnosis.push("当前漏斗已经产生有效转化，下一步应复制高回复岗位和渠道，而不是大幅更换方向。");
    actions.push("提高表现最好岗位方向的投递占比，并为相同类型职位复用经过验证的简历版本。 ");
  }

  if (byRole[0]?.applied >= 3) actions.push(`当前表现较好的岗位方向是“${byRole[0].name}”（${byRole[0].replyRate}% 回复率），下一轮优先验证这一方向。`);
  if (byChannel[0]?.applied >= 3) actions.push(`当前表现较好的渠道是“${byChannel[0].name}”（${byChannel[0].replyRate}% 回复率），增加该渠道的高质量投递。`);

  let comparison = null;
  if (previousReview?.metrics) {
    comparison = {
      replyRateChange: metrics.replyRate - previousReview.metrics.replyRate,
      interviewRateChange: metrics.interviewRate - previousReview.metrics.interviewRate,
      appliedChange: metrics.applied - previousReview.metrics.applied
    };
  }

  return { metrics, byRole: byRole.slice(0, 6), byChannel, diagnosis, actions, comparison, createdAt: new Date().toISOString() };
}
