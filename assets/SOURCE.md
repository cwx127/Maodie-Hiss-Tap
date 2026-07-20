# 素材来源

平静态来自一张公开动图：

- 原图地址：<https://imggifb.gamersky.com/users/clubcontent/2025/05/29/origin_1913380_1349395.gif>
- 来源页面：<https://club.gamersky.com/activity/1467155?club=1157>
- 使用方式：提取第一帧作为平静态，再做等比例高质量放大；没有移除水印或修改原始画面内容。

哈气态使用用户提供的正面张嘴图片：

- 使用方式：按页面竖版画框居中裁切并放大到 `720×954`，保留原始猫脸、獠牙和背景；没有去水印。
- 页面使用的 `maodie-calm-head.png` 与 `maodie-hiss-head.png` 进一步按两张原图各自的头部中心裁成 `1024×1024` 圆形透明 PNG，没有重绘猫脸。

原始页面没有明确的再分发许可。当前版本用于本地个人 Demo；如需公开部署或商业使用，请先获得原作者/页面运营方授权。

哈气音频来源：

- 视频：<https://www.bilibili.com/video/BV1gFtizTEGT/>
- 标题：耄耋哈气纯享版
- 处理方式：提取视频媒体流，并以浏览器可识别的 `.mp4` 扩展名保留在本地；每次交互读取片段开头约 `1.4` 秒，再按固定音阶变调播放，没有上传、发布或改编整段视频。
- B 站页面标注“未经作者授权，禁止转载”，因此当前音频仅用于本地个人 Demo，不应直接公开分发。

音阶交互参考：

- 项目：<https://github.com/MarkCup-Official/Dagou-Tap-New>
- 参考内容：固定分区、十二平均律半音倍率和 `AudioBufferSourceNode.playbackRate` 变调思路；当前项目没有复制其代码或音频素材。
