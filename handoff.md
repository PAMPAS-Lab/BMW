# BMW current handoff

## 当前工作

当前视频范围为真实网页素材→有来源与语音区间的素材索引→句级画面表达→原声/解说编排→关键状态检查和实际 MP4 手机审片。录屏提供显式段落压缩与保留上下文的放大镜；专用 AI 素材生成仍暂缓。实现字段与边界以功能规格为准。
## 当前实现

BMW 是本仓库唯一应用，id bmw、Profile BMW、分区 persist:bmw。apps/bmw 装配 DSH、Codex、Qoder CN；核心依赖 agent-contract，各官方运行时拥有 Agent 循环，模型只有 browser 工具。正常启动只接受当前 v2 Agent 数据；历史迁移是显式独立命令。

Studio 默认卡片内编辑脚本、画面与预览；高级编辑使用全窗口资源／画布／属性／多轨，同一 Assistant 转为浮框或停靠。两种视图共享 Video Document 2.0–2.5。简洁视图是可逆子集；独立图层／音轨／自由关键帧要求高级编辑，撤销或移除后可恢复简洁资格。两种视图共享选中对象、播放头、保存、CAS、签名撤销及真实 Project 素材。

现有能力包括零分镜素材准备、初稿与后台通知、主轨和独立图层／音轨编辑、有限关键帧、有限整镜头分割与可信语音／原声字幕分配、颜色／模糊、独立静音、参考帧抽样与记录管理、可选逐项文本／字幕样式审阅，以及选择性旁白更新、制作取消／清理／明确续做、MP4／封面／字幕与来源清单交付。详细字段、预算和拒绝规则只维护在 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)。

当前限制：受限多轨不构成通用 NLE；没有任意 HTML／渲染脚本、完整视频语义审阅、自动词／字声学同步或专用 AI 素材生成。原生 Session 桌面同步、fork、steer、审批与 nativeOpen 未启用；无远控客户端、签名安装器或自动更新。

生产可靠性能力包括局部字幕／卡片编辑、有界摘要与来源分页、共享完整字幕底框、按当前成片指纹持久审片进度、分开的技术／版式／Agent／用户意见、官方事件与实际保存进度及显式续做输入准备。2.5 仅在句锚含时间方法记录时使用；只读节奏检查核对实际旁白并提示长句、阅读窗口和图解关联问题，不认定声学精度、不自动修改或重发。当前 Codex/GPT-6.1 Sol 与 Qoder CN/Qwen3.8-Max 独立新稿均完成最终指纹关键帧审阅、单独整片 Agent 意见及实际 BMW 连续播放。当前完整离线回归 139 passed／0 failed／5 external opt-in not-run；真实制作证据与音轨核验、用户听审和声学精度的范围边界见 [VERIFICATION.md](docs/VERIFICATION.md)，不以隔离夹具替代。

## 验证与维护

按 [AGENTS.md](AGENTS.md) 使用 TypeScript、具名接口和实际输入校验；保留现有 Profile、媒体、未提交工作、HEAD 与 index。测试仅使用临时 Profile／Home／Workspace，不接触生产钥匙串，也不把离线夹具当作付费模型、语义质量或生产体验证明。

Schema 由 docs:video-schema 生成，check:video-schema 保证与运行时代码一致。代码／操作／测试变化后刷新 docs:features 与 docs:architecture；功能清单从有效 Action Schema 生成 Studio 操作，架构表包含运行时测试分支。局部范围先 test:plan／test:affected；完整一致性核查使用 verify:stability。含构建的命令顺序执行，资源受限时设置 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。构建不热替换已启动应用的主进程。

本轮检查入口及结果在 [VERIFICATION.md](docs/VERIFICATION.md)，当前产品状态在 [PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，Studio 已实现／暂缓范围在 [VIDEO_STUDIO_NEXT.md](docs/VIDEO_STUDIO_NEXT.md)。旧阶段判断、失败尝试和原验收记录保留在 [历史快照](docs/history/2026-10-07-consistency/index.md)，不能当作当前待办。
