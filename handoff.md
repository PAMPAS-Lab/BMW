# BMW current handoff

## 当前工作

用户认为简洁与高级两个方向基本成立，暂不继续优化 UI／工作流。用户已确认共享视频 schema 定义并要求实施。当前落实 Video Document 2.0、类型编辑命令、v1 原字节备份迁移，以及简洁编辑可逆子集；UI 仅补充必要的兼容性说明与返回限制。专用 AI 图片／视频素材生成暂缓。

## 当前实现

BMW 是本仓库唯一应用，id bmw、Profile BMW、分区 persist:bmw。apps/bmw 装配 DSH、Codex、Qoder CN；核心依赖 agent-contract，各官方运行时拥有 Agent 循环，模型只有 browser 工具。正常启动只接受当前 v2 Agent 数据；历史迁移是显式独立命令。

Studio 默认卡片内编辑脚本、画面与预览；高级编辑使用全窗口资源／画布／属性／多轨，同一 Assistant 转为浮框或停靠。两种视图共享 Video Document 2.0。简洁视图是可逆子集；独立图层／音轨／自由关键帧要求高级编辑，撤销或移除后可恢复简洁资格。两种视图共享选中对象、播放头、保存、CAS、签名撤销及真实 Project 素材。

现有能力包括零分镜素材准备、初稿与后台通知、主轨和独立图层／音轨编辑、有限关键帧、有限整镜头分割与可信语音／原声字幕分配、颜色／模糊、独立静音、参考帧抽样与记录管理、可选逐项文本／字幕样式审阅，以及选择性旁白更新、制作取消／清理／明确续做、MP4／封面／字幕与来源清单交付。详细字段、预算和拒绝规则只维护在 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)。

当前限制：受限多轨不构成通用 NLE；没有任意 HTML／渲染脚本、完整视频语义审阅、自动词／字声学同步或专用 AI 素材生成。原生 Session 桌面同步、fork、steer、审批与 nativeOpen 未启用；无远控客户端、签名安装器或自动更新。

## 验证与维护

按 [AGENTS.md](AGENTS.md) 使用 TypeScript、具名接口和实际输入校验；保留现有 Profile、媒体、未提交工作、HEAD 与 index。测试仅使用临时 Profile／Home／Workspace，不接触生产钥匙串，也不把离线夹具当作付费模型、语义质量或生产体验证明。

Schema 由 docs:video-schema 生成，check:video-schema 保证与运行时代码一致。代码／操作／测试变化后刷新 docs:features 与 docs:architecture；功能清单从有效 Action Schema 生成 Studio 操作，架构表包含运行时测试分支。局部范围先 test:plan／test:affected；完整一致性核查使用 verify:stability。含构建的命令顺序执行，资源受限时设置 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。构建不热替换已启动应用的主进程。

本轮检查入口及结果在 [VERIFICATION.md](docs/VERIFICATION.md)，当前产品状态在 [PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，Studio 已实现／暂缓范围在 [VIDEO_STUDIO_NEXT.md](docs/VIDEO_STUDIO_NEXT.md)。旧阶段判断、失败尝试和原验收记录保留在 [历史快照](docs/history/2026-10-07-consistency/index.md)，不能当作当前待办。
