const express = require('express');
const cors = require('cors');
const path = require('path');
const youtubedl = require('youtube-dl-exec');

const app = express();
// 允许跨域，彻底解决前端请求被拦截的问题
app.use(cors());
// 增加解析容量，防止超长链接或冗长的配置数据报错
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件托管：直接让服务器把当前最外层目录当作静态网站展示
app.use(express.static(__dirname));

// 当用户访问网站根目录时，直接发送最外层的标准主页文件
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 核心：国内商业API + 海外自建引擎 混合双擎接口
// ==========================================
app.post('/api/parse', async (req, res) => {
    // 接收前端传来的：视频链接、以及前端从管理后台读到的商业接口地址和密钥
    const { url, alapiUrl, alapiToken } = req.body;
    
    if (!url) {
        return res.status(400).json({ code: 400, msg: "解析链接不能为空" });
    }

    try {
        console.log(`[解析任务开始] 目标: ${url}`);
        
        // 1. 智能路由判定
        const isOverseas = url.includes('tiktok.com') || 
                           url.includes('youtube.com') || 
                           url.includes('youtu.be') || 
                           url.includes('instagram.com') || 
                           url.includes('x.com') || 
                           url.includes('twitter.com');
        
        if (isOverseas) {
            // ------------------------------------------
            // 链路 A：海外平台 -> 走底层开源引擎 + 静态住宅代理
            // ------------------------------------------
            console.log('🌍 路由分配：海外平台 -> 启用本地开源引擎抓取');
            
            const options = {
                dumpSingleJson: true,
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true,
                // 【请填写您的真实海外静态住宅/ISP代理】
                proxy: 'http://kobszbgm:3ayuat63t8rx@9.142.32.224:7895' 
            };

            const output = await youtubedl(url, options);
            
            return res.json({
                code: 200,
                msg: "success",
                data: {
                    title: output.title || '海外提取文件',
                    cover: output.thumbnail || 'https://placehold.co/400x400/1e293b/94a3b8?text=No+Cover',
                    music_url: output.requested_downloads?.[1]?.url || output.url, 
                    video_url: output.requested_downloads?.[0]?.url || output.url,
                    platform: output.extractor || '海外通用平台'
                }
            });

        } else {
            // ------------------------------------------
            // 链路 B：国内平台 -> 请求您在后台配置的商业 API
            // ------------------------------------------
            console.log('🇨🇳 路由分配：国内平台 -> 启用商业API直连');
            
            // 校验前端是否成功传来了后台的配置
            if (!alapiUrl || !alapiToken) {
                return res.status(400).json({ code: 400, msg: "未获取到有效的商业API配置，请检查管理后台设置" });
            }

            const formData = new URLSearchParams();
            formData.append('token', alapiToken); // 使用管理后台配置的密钥
            formData.append('url', url);

            // 让咱们自己的服务器去请求管理后台配置的接口地址
            const apiResponse = await fetch(alapiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });

            const apiData = await apiResponse.json();

            if (apiData.code === 200 && apiData.data) {
                const music = apiData.data.music_url || apiData.data.audio_url || apiData.data.video_url;
                return res.json({
                    code: 200,
                    msg: "success",
                    data: {
                        title: apiData.data.title || '国内提取文件',
                        cover: apiData.data.cover || 'https://placehold.co/200x200/1e293b/94a3b8?text=No+Cover',
                        music_url: music,
                        video_url: apiData.data.video_url,
                        platform: apiData.data.platform || '国内平台'
                    }
                });
            } else {
                throw new Error(apiData.msg || "商业接口返回错误");
            }
        }
    } catch (error) {
        console.error("[解析任务失败]:", error.message);
        res.status(500).json({ code: 500, msg: `解析失败: ${error.message}` });
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 混合双擎解析服务已启动，监听端口: ${PORT}`);
});
