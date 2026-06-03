const express = require('express');
const cors = require('cors');
const path = require('path');
const youtubedl = require('youtube-dl-exec');

const app = express();
// 允许跨域，彻底解决前端请求被拦截的问题
app.use(cors());
app.use(express.json());

// 静态文件托管：直接让服务器把当前最外层目录当作静态网站展示
app.use(express.static(__dirname));

// 当用户访问网站根目录时，直接发送最外层的标准主页文件 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 核心：全平台音视频智能解析 API 接口
app.post('/api/parse', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ code: 400, msg: "解析链接不能为空" });
    }

    try {
        console.log(`[解析任务开始] 目标链接: ${url}`);
        
        // 1. 基础解析配置
        const options = {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
        };

        // 2. 智能代理路由（分流判定机制）
        const isOverseas = url.includes('tiktok.com') || 
                           url.includes('youtube.com') || 
                           url.includes('youtu.be') || 
                           url.includes('instagram.com') || 
                           url.includes('x.com') || 
                           url.includes('twitter.com');
        
        if (isOverseas) {
            console.log('🌍 检测到海外平台，正在挂载 ISP 静态住宅代理隧道...');
            // 💡 提示：测试阶段这里可以随便填。等您购买了海外静态代理后，把这行换成您真实的代理凭证即可
            options.proxy = 'http://kobszbgm:3ayuat63t8rx@9.142.32.224:7895'; 
        } else {
            console.log('🇨🇳 检测到国内平台，正在使用服务器原生网络极速直连...');
            // 国内平台（如抖音、小红书、B站）直接走直连，不挂代理速度最快
        }

        // 3. 唤起底层引擎执行抓取
        const output = await youtubedl(url, options);

        // 4. 组装前端需要的 JSON 格式并返回
        res.json({
            code: 200,
            msg: "success",
            data: {
                title: output.title || '无水印提取文件',
                cover: output.thumbnail || 'https://placehold.co/400x400/1e293b/94a3b8?text=No+Cover',
                // 获取最高质量的音频和视频直链
                music_url: output.requested_downloads?.[1]?.url || output.url, 
                video_url: output.requested_downloads?.[0]?.url || output.url,
                platform: output.extractor || '通用平台'
            }
        });
        
        console.log(`[解析任务成功] 标题: ${output.title}`);

    } catch (error) {
        console.error("[解析任务失败] 引擎报错:", error.message);
        res.status(500).json({ code: 500, msg: "抓取失败，可能遇到强力防盗链拦截或链接无效" });
    }
});

// 启动服务器（Zeabur 会自动分配端口，如果本地运行默认是 3000）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 全栈智能解析服务已启动，正在监听端口: ${PORT}`);
});
