import type {Platform} from './rolling-contract.js'
export interface SourcePreset {id:string;title:string;group:'official'|'research'|'reporting'|'social';platform:Platform;url:string;fallbackUrls:string[];identityUrl:string;region:string;language:string;notes:string}
const preset=(id:string,title:string,group:SourcePreset['group'],platform:Platform,url:string,identityUrl:string,notes:string,region='global',language='en',fallbackUrls:string[]=[]):SourcePreset=>({id,title,group,platform,url,identityUrl,notes,region,language,fallbackUrls})
/** Suggested entry points, never a claim of current accessibility or verified news. */
export const AI_NEWS_SOURCE_PRESETS:readonly SourcePreset[]=Object.freeze([
 preset('openai-news','OpenAI 公告','official','web','https://openai.com/news/','https://openai.com/','核对正文署名和原始发布日期；列表日期不替代正文。','global','multi',['https://openai.com/zh-Hans-CN/news/']),
 preset('anthropic-news','Anthropic 公告','official','web','https://www.anthropic.com/news','https://www.anthropic.com/','产品、政策及安全公告分别归类，避免同事件重复推荐。'),
 preset('google-ai','Google AI','official','web','https://blog.google/innovation-and-ai/technology/ai/','https://blog.google/','进入原文核对日期，专题置顶不代表最新。','global','en',['https://blog.google/technology/ai/']),
 preset('deepmind-news','Google DeepMind','official','web','https://deepmind.google/blog/','https://deepmind.google/','列表仅月份时必须进入正文，不推断具体发布日期。'),
 preset('microsoft-research','Microsoft Research','research','web','https://www.microsoft.com/en-us/research/blog/','https://www.microsoft.com/en-us/research/','研究成果与产品可用性分开核对。'),
 preset('meta-ai','Meta AI','official','web','https://ai.meta.com/blog/','https://ai.meta.com/','官方模型、论文与开源公告；受限则保留状态，不视为无新增。'),
 preset('nvidia-ai','NVIDIA AI','official','web','https://blogs.nvidia.com/blog/category/generative-ai/','https://www.nvidia.com/','核对发布方原文；商业性能指标保留限定条件。'),
 preset('huggingface-blog','Hugging Face Blog','research','web','https://huggingface.co/blog','https://huggingface.co/','区分机构文章、社区投稿及模型作者，原始模型卡另行核验。'),
 preset('qwen-research','Qwen 研究','official','web','https://qwen.ai/research','https://github.com/QwenLM','新研究入口；旧GitHub Pages博客作为已标日期的备用资料。','global','multi',['https://qwenlm.github.io/blog/']),
 preset('arxiv-ai','arXiv cs.AI','research','web','https://arxiv.org/list/cs.AI/recent','https://arxiv.org/','预印本不等于同行评审；区分首次提交和修订日期。'),
 preset('mit-ai','MIT Technology Review AI','reporting','web','https://www.technologyreview.com/topic/artificial-intelligence/','https://www.technologyreview.com/','独立报道；付费墙保留缺口，不能把摘要当完整原文。'),
 preset('techcrunch-ai','TechCrunch AI','reporting','web','https://techcrunch.com/category/artificial-intelligence/','https://techcrunch.com/','用于交叉报道与争议补查，回溯原始公告。'),
 preset('reuters-ai','Reuters AI','reporting','web','https://www.reuters.com/technology/artificial-intelligence/','https://www.reuters.com/','核对当事方回应和执行进展；订阅/访问受限时明确记录。'),
 preset('qbitai','量子位','reporting','web','https://www.qbitai.com/','https://www.qbitai.com/','中文线索及采访；研究或产品结论回溯原站。','CN','zh'),
 preset('jiqizhixin','机器之心','reporting','web','https://www.jiqizhixin.com/','https://www.jiqizhixin.com/','中文研究/产业报道；区分资讯、解读和商业稿。','CN','zh'),
 preset('x-openai','X · OpenAI','social','x','https://x.com/OpenAI','https://openai.com/','从官网社交链接核对账号；帖子须保存原始status URL，指标仅当时可见。','account-visible','en'),
 preset('x-anthropic','X · Anthropic','social','x','https://x.com/AnthropicAI','https://www.anthropic.com/','从官网核对账号；转发与原创分开，不能只按同名认证。','account-visible','en'),
 preset('x-deepmind','X · Google DeepMind','social','x','https://x.com/GoogleDeepMind','https://deepmind.google/','机构账号观察；关键事实仍回溯原文。','account-visible','en'),
 preset('x-ai-search','X · AI 实时主题','social','x','https://x.com/search?q=AI&f=live','https://help.x.com/en/using-x/x-search','发现入口，不代表权威或全站热度；逐条进入原创帖子，登录墙不算无新增。','page-visible-unspecified','multi'),
 preset('x-trends','X · 趋势观察','social','x','https://x.com/explore/tabs/trending','https://help.x.com/en/using-x/x-trending-faqs','记录实际显示的地区/个性化范围及排名原文；没有连续观察不能声称增长。','page-visible-unspecified','multi'),
 preset('youtube-openai','YouTube · OpenAI','social','youtube','https://www.youtube.com/@OpenAI/videos','https://openai.com/','官网频道链接核对身份；视频发布时间不代替录制日期，不下载整频道。','channel-visible','en',['https://www.youtube.com/OpenAI']),
 preset('youtube-anthropic','YouTube · Anthropic','social','youtube','https://www.youtube.com/@anthropic-ai/videos','https://www.anthropic.com/','频道身份须从机构原站交叉核对；采访、演示与二次解读分开。','channel-visible','en'),
 preset('youtube-deepmind','YouTube · Google DeepMind','social','youtube','https://www.youtube.com/@GoogleDeepMind/videos','https://deepmind.google/','官方演示与研究采访，浏览量不等于事实核实或全站趋势。','channel-visible','en'),
 preset('youtube-ai-search','YouTube · AI 主题发现','social','youtube','https://www.youtube.com/results?search_query=artificial+intelligence','https://support.google.com/youtube/','主题搜索可能个性化，不能冒认统一热点榜；进入原视频核对频道、日期和可见指标。','page-visible-unspecified','en')
])
export function sourcePreset(id:string):SourcePreset {const value=AI_NEWS_SOURCE_PRESETS.find(p=>p.id===id);if(!value)throw new Error('Unknown fixed source preset');return structuredClone(value)}
