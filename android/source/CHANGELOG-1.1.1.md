# 安卓本地演示版 1.1.1

本轮继续安卓维护，不重启 SafeLease-Pilot-Auto-Recovery。手机仍未安装演示包，本轮没有重新尝试绕过 INSTALL_FAILED_USER_RESTRICTED；真机摄像头与保存验收仍待用户安装后进行。

## 已复现的问题

- 1.1.0本地接口允许GET调用工单resolve，实际把open/hold=1变为resolved/hold=0。已在模拟器TEST账户新建工单复现，见qa/v111-before.json。此问题不能当作安全的只读行为。
- 资料库安装直接写reference.db，中途退出会留下无法使用的副本；再次启动只判断文件存在，不能修复。此文件为公开参考数据，不是租约业务库。

## 修复

- 读取接口只接受GET，结案、邀请、问卷、清理等更改只接受POST；不支持的方法405且不改变状态。原生照片资源也拒绝非GET方法。
- 非法JSON、数组、null返回400；标准Request对象保留method、body和CSRF，合法POST可以正常操作。
- 参考库使用临时文件、文件同步、SHA-256核对与原子替换。现有副本损坏时从APK恢复，业务库和已拍照片不重置。
- 相机和文件保存错误提示使用Android设置与系统保存窗口，不再引导去浏览器设置。

## 验收

新增9项回归全部通过，见qa/android-v111.json；原有11项安卓核心流程再次通过。角色重启3项、显式WebView断网1项通过。原有13项模型检查与相机拒绝/允许/拍摄、系统SAF保存及原片哈希证据保留，不把历史测试重新计为新增。

资料库故障注入只在QA模拟器进行：保留旧参考副本，将reference.db替为68字节非SQLite文件，升级后执行实际检索与quick_check，再核对私有参考库SHA-256恢复为367422258b09a29c56eef35cb809372a1c7d7281189915bb725425f66cf6b700。见qa/v111-reference-repair.json。业务照片仍保留。

1.1.1继续使用sg.safelease.presentation包名和原签名，可覆盖1.1.0演示版并保留记录。原sg.safelease.app旧版与已交付的1.1.0压缩包不删除。此版本仍为本地presentation：角色是同手机模拟，时间来自设备，实时图片服务未配置，历史真实图片结果已标识回放。
