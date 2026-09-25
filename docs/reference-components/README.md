# 原始组件参考归档

本目录保存用户提供的原始组件文本，避免附件路径失效或后续只记得组件名而丢失具体实现。文件是设计与实现参考，不会直接进入生产构建。

## 已归档

- 动效与指针：LogoLoop、TargetCursor、SplashCursor、RippleDistortion。
- 资料库视图：DepthCarousel、AccordionGallery、OptionWheel、InfiniteMenu、FolderFloat、GridMotion。
- 引导与导航：Stepper、BranchedMenu。
- 状态与通知：ThoughtLine、SwipeToast、SwipeRow、BellToggle、CallChip。
- 输入与设置：VoicePill、PromptBar、GlideSelect、JellyRadio、CodeSlots、RubberSegment。
- 安全操作与编辑：FuseButton、SlideCommit、WarmTooltip。
- GPU 背景：MoltenMetal、AeroShards、WebThreads、Topography、Scanner、Ferrofluid、LiquidEther、Prism、SideRays、LightRays、PixelBlast、LineWaves、SoftAurora、Particles、GradientBlinds、Beams、PixelSnow、Galaxy、Threads、Orb。

## 内联提供但无独立附件

- AnimatedContent、FadeContent、ClickSpark、GlassIcons、Iridescence。
- 其中 AnimatedContent、FadeContent、ClickSpark 的交互思路和 GlassIcons 的资料库表达已经适配到现有代码；Iridescence 仍在路线清单中。

## 使用方式

实现新功能前先查看 [功能路线](../feature-roadmap.md)，再读取对应的 `.txt` 原始代码。适配时需要遵循当前 TypeScript、可访问性、减少动态效果、按需加载和资源销毁约定，不能直接复制后视为完成。
