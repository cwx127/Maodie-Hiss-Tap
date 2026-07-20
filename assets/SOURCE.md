# 素材来源

## 耄耋透明图片

- 视频：<https://www.bilibili.com/video/BV1DtYKzPEHs/>
- 标题：`【绿幕素材】耄耋的圆头.gb`
- 作者：`不可燃物__`
- 处理方式：从约 `17s` 的平静帧和约 `20s` 的张嘴帧截取原始画面，按绿色背景生成软透明蒙版、去除绿色溢色、收缩 1 像素边缘，再等比放大到 `1024×1024`。没有重绘猫脸。

## 哈基米短采样

- 视频：<https://www.bilibili.com/video/BV1QZgzzGEBK/>
- 标题：`【素材】哈基米音乐素材合集`
- 作者：`I隔壁小孩I`
- 处理方式：只读取第一段素材，从约 `1.56s / 2.11s / 2.59s` 的三个起音附近分别截取 `哈 / 基 / 米`，输出为单声道 WAV，并加入很短的淡入淡出；运行时再通过 Web Audio 生成三档音高。

## 交互参考

- 官方玩具：<https://www.bilibili.com/toy/Dagou-Tap/index.html>
- 开源项目：<https://github.com/MarkCup-Official/Dagou-Tap-New>
- 参考内容：隐藏分区、张嘴图片叠放、点击弹簧放大和 `AudioBufferSourceNode.playbackRate` 变调思路；当前项目没有复制其代码或音频素材。

以上来源没有提供明确的再分发许可。当前版本仅用于私有仓库和本地个人 Demo；公开部署或商业使用前应取得原作者授权。
