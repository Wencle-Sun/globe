/* ==========================================================
   地球仪 Globe · 手势转动 + 缩放
   ----------------------------------------------------------
   · 手在摄像头前左右 / 上下移动  → 地球跟着转，松手还会滑一会儿
     （就像用手拨真的地球仪）
   · 五指收拢 / 张开              → 缩小 / 放大
   · 鼠标拖拽也能转，滚轮能缩放（不依赖摄像头）

   原理：每帧比较摄像头画面，算出「运动的方向」和「运动的范围」，
         方向 → 转动，范围 → 缩放。不联网、不用 AI 模型。
   ========================================================== */

// ---------------- 可调参数 ----------------
const DOT_STEP    = 1.0;    // 陆地采样精度（度）：越小越密（1.0° ≈ 13700 个点，接近实心）
const SEA_STEP    = 5.0;    // 海洋采样精度（度）：数值越大小蓝点越疏
const TARGET_FPS  = 80;     // 渲染上限（120 = ProMotion 满速 / 80 = 更省电 / 60 = 最省）
const LAND_DOT    = 2.8;    // 陆地点大小：调大 → 点连成面（太小会一颗颗闪）
const LAND_DOT_Z  = 1.6;    // 越朝向屏幕的陆地点再加大多少（做纵深，平滑变化）

// 航线虚线的"墨水"：夜面用冷蓝（压在黑暗上），受光面用深靛蓝墨水（压在象牙白陆地上）
// 想更淡或更明显就改每档的 a（不透明度）
const ROUTE_STYLE = [
  { r: 158, g: 190, b: 222, a: 0.14 },   // 夜面：冷蓝
  { r: 104, g: 138, b: 172, a: 0.30 },   // 暮光
  { r: 38,  g: 62,  b: 96,  a: 0.42 }    // 受光面：深靛蓝墨
];
const ROUTE_FLASH_RGB = { r: 255, g: 222, b: 156 }; // 闪烁时过渡到城市灯点的暖黄色

// 夜面城市灯光：所有城市以不同相位缓慢呼吸，不闪烁
const CITY_BREATH_PERIOD = 8;       // 呼吸周期（秒）
const CITY_BREATH_DEPTH  = 0.035;   // 亮度起伏幅度（3.5%，只做很轻的变化）

// 放大后，屏幕中央区域的城市名会更清楚；离开中央后平滑回到普通亮度。
const CITY_FOCUS_ZOOM_START = 1.25; // 超过这个倍率开始出现聚焦增强
const CITY_FOCUS_ZOOM_FULL  = 1.95; // 到这个倍率达到完整增强
const CITY_FOCUS_RADIUS     = 0.25; // 聚焦区半径 = 屏幕短边 × 这个比例
const CITY_FOCUS_MAX_SIZE   = 2.5;   // 中央城市名最多增加的字号（px）

// 放大粒子吸积：低倍率漂浮，高倍率吸附到陆地并持续增密。
const ARRIVAL_COUNT            = 4200;
const ARRIVAL_SCREEN_MARGIN    = 0.08;
const ARRIVAL_FLOAT_DRIFT      = 0.022;
const ARRIVAL_CORE_RADIUS      = 1.12;  // 低倍率时地球周围的粒子净空区
const ARRIVAL_CORE_REVEAL      = 0.62;  // 附着进度超过这里后，核心区才逐渐开放
const ARRIVAL_ZOOM_START       = 1.35;
const ARRIVAL_ZOOM_ACCEL       = 1.55;
const ARRIVAL_ZOOM_FULL        = 2.15;

// 点选城市和空间站过顶事件。
const CITY_CLICK_RADIUS        = 22;
const CITY_CLICK_MAX_MOVE      = 6;
const CITY_CLICK_MAX_MS        = 350;
const CITY_FOCUS_ZOOM          = 1.90;
const CITY_FOCUS_SECONDS       = 0.90;
const CITY_ROUTE_BOOST         = 1.45;
const CITY_ROUTE_FLASH_MS      = 900;
const CITY_ROUTE_FLASH_GAIN    = 0.55;
const STATION_PASS_RADIUS      = 26;
const STATION_PASS_PULSE_MS    = 1200;
const STATION_PASS_CITY_MS     = 60000;
const STATION_PASS_GLOBAL_MS   = 8000;
const METEOR_SHOWER_LABEL_MS   = 2000;
const HAND_PINCH_CLOSE_RATIO   = 0.45;
const HAND_PINCH_RELEASE_RATIO = 0.58;
const HAND_PINCH_DOUBLE_MS     = 1100;
const HAND_PINCH_MIN_GAP_MS    = 120;
const HAND_PINCH_BLOCK_MS      = 520;
const CITY_MODE_SWIPE_DISTANCE = 0.024; // 摆手切城距离：越小越灵敏
const CITY_MODE_SWIPE_COOLDOWN = 520;   // 连续切换的最短间隔
const CITY_MODE_REARM_DISTANCE = 0.008; // 摆手后更容易重新待命
const CITY_MODE_REARM_FRAMES   = 2;
const CITY_MODE_FOCUS_READY    = 0.70;  // 聚焦动画到 70% 后即可继续切换
const CITY_MODE_SHAKE_DISTANCE = 0.008;
const CITY_MODE_SHAKE_WINDOW_MS = 1400;
const CITY_MODE_SHAKE_REVERSALS = 2;
const OBSERVER_LABEL_GROW_PX   = 2.2;
const OBSERVER_LABEL_GROW_RATE = 0.14;
const OBSERVER_LABEL_SHRINK_RATE = 0.09;
const HAND_FIVE_PINCH_EXIT_RATIO = 0.42; // 5 指全捏合：3D 指尖最大间距/掌心尺寸
const HAND_FIVE_PINCH_HOLD       = 5;    // 持续全捏合退出确认帧数
const KEY_CITIES = [
  "北京", "上海", "东京", "新加坡", "迪拜", "莫斯科", "伊斯坦布尔",
  "伦敦", "巴黎", "纽约", "旧金山", "圣保罗", "悉尼", "开普敦"
];
const OBSERVER_ENTRY_CITIES = ["上海", "纽约"];
const KEY_CITY_EN = {
  "北京": "Beijing", "上海": "Shanghai", "东京": "Tokyo", "新加坡": "Singapore",
  "迪拜": "Dubai", "莫斯科": "Moscow", "伊斯坦布尔": "Istanbul", "伦敦": "London",
  "巴黎": "Paris", "纽约": "New York", "旧金山": "San Francisco",
  "圣保罗": "São Paulo", "悉尼": "Sydney", "开普敦": "Cape Town"
};

// 放大后逐步显示平时只作为光点存在的城市名称。
const EXTRA_CITY_LABEL_ZOOM_START = 1.45;
const EXTRA_CITY_LABEL_ZOOM_FULL  = 2.15;
const EXTRA_CITY_LABEL_MAX        = 32; // 同屏最多补充多少条，防止文字过密

// 背景星层：少量星点慢闪 + 极淡星尘 + 偶发点阵流星
const STAR_TWINKLE_COUNT       = 18;    // 参与慢闪的背景星数量
const STAR_TWINKLE_PERIOD_MIN  = 12;    // 最慢/最快呼吸周期（秒）
const STAR_TWINKLE_PERIOD_MAX  = 24;
const STAR_TWINKLE_DEPTH_MIN   = 0.08;  // alpha 起伏 8%~16%
const STAR_TWINKLE_DEPTH_MAX   = 0.16;
const STAR_DUST_COUNT          = 28;    // 极淡漂移星尘数量
const STAR_DUST_SPEED_MIN      = 0.35;  // 漂移速度（px/s）
const STAR_DUST_SPEED_MAX      = 0.90;
const METEOR_FIRST_MIN         = 5;     // 首次出现前的等待（秒）
const METEOR_FIRST_MAX         = 9;
const METEOR_GAP_MIN           = 20;    // 之后的流星事件间隔（秒）
const METEOR_GAP_MAX           = 34;
const METEOR_PAIR_CHANCE       = 0.12;  // 低概率补第二颗，形成很短的成对事件
const METEOR_MAX_ACTIVE        = 2;     // 同时最多两颗
const METEOR_DURATION_MIN      = 1.00;  // 短流星飞行时间（秒）
const METEOR_DURATION_MAX      = 1.55;
const METEOR_AFTERGLOW         = 0.45;  // 到达路径末端后的余辉（秒）
const METEOR_LENGTH_MIN        = 140;   // 短流星长度（px）
const METEOR_LENGTH_MAX        = 320;
const METEOR_LONG_RATIO_MIN    = 0.42;  // 长流星 = 屏幕对角线比例
const METEOR_LONG_RATIO_MAX    = 0.72;
const METEOR_ULTRA_RATIO_MIN   = 0.75;  // 超长流星 = 屏幕对角线比例
const METEOR_ULTRA_RATIO_MAX   = 1.05;
const METEOR_LONG_CHANCE       = 0.17;  // 普通流星：长流星 17%
const METEOR_ULTRA_CHANCE      = 0.05;  // 普通流星：超长流星 5%
const METEOR_BOW_MIN           = 3;     // 每条流星的曲率随机范围（px）
const METEOR_BOW_MAX           = 11;
const METEOR_SCALE_MIN         = 0.85;  // 普通流星大小随机范围
const METEOR_SCALE_MAX         = 1.45;
const METEOR_TRAIL_POINTS      = 20;    // 点阵尾迹点数

// 极其稀有的流星雨事件：短时间密集、单颗更小，结束后恢复长时间静默。
const SHOWER_FIRST_MIN         = 120;   // 首次流星雨等待 2~5 分钟
const SHOWER_FIRST_MAX         = 300;
const SHOWER_GAP_MIN           = 900;   // 之后的间隔 15~30 分钟
const SHOWER_GAP_MAX           = 1800;
const SHOWER_DURATION_MIN      = 16;    // 流星雨持续 16~20 秒
const SHOWER_DURATION_MAX      = 20;
const SHOWER_SPAWN_MIN         = 0.06;  // 每隔 0.06~0.15 秒补一颗
const SHOWER_SPAWN_MAX         = 0.15;
const SHOWER_MAX_ACTIVE        = 26;    // 同时最多 26 颗
const SHOWER_NEAR_MAX_ACTIVE   = 12;    // 近层亮流星上限
const SHOWER_FAR_MAX_ACTIVE    = 16;    // 远层细密流星上限
const SHOWER_NEAR_CHANCE       = 0.58;  // 每次补星生成近层的概率
const SHOWER_FAR_SCALE_MIN     = 0.38;  // 远层大小为近层基础尺寸的 38%~62%
const SHOWER_FAR_SCALE_MAX     = 0.62;
const SHOWER_FAR_LENGTH_MIN    = 0.30;  // 远层轨迹长约屏幕对角线的 30%~65%
const SHOWER_FAR_LENGTH_MAX    = 0.65;
const SHOWER_FAR_DURATION_MIN  = 1.2;   // 远层基础飞行时长
const SHOWER_FAR_DURATION_MAX  = 2.0;
const SHOWER_FAR_TRAIL_POINTS  = 10;    // 远层尾迹更简省
const SHOWER_FAR_ALPHA_SCALE   = 0.42;  // 远层统一降低尾迹、火花和头部亮度
const SHOWER_FAR_SPEED_MIN     = 0.80;  // 远层速度差异
const SHOWER_FAR_SPEED_MAX     = 1.20;
const SHOWER_SCALE_MIN         = 0.68;  // 流星雨短流星的基础大小
const SHOWER_SCALE_MAX         = 0.92;
const SHOWER_LONG_CHANCE       = 0.32;  // 流星雨：长流星明显增多
const SHOWER_ULTRA_CHANCE      = 0.18;  // 流星雨：超长超大概率明显提高
const SHOWER_RAMP_SECONDS      = 1.5;   // 开场增强时间
const SHOWER_TAPER_SECONDS     = 2.0;   // 结束前衰减时间
const SHOWER_RADIANT_ALPHA     = 0.035; // 辐射点冷光最大 alpha
const SHOWER_GOLD_OPENING_SEC  = 2.0;   // 手动触发的金色开场时长（秒）
const SHOWER_GOLD_OPENING_CHANCE = 0.55;// 开场前 2 秒的金色比例
const SHOWER_GOLD_CHANCE       = 0.28;  // 开场后的金色比例

// ----------------------------------------------------------
// 视觉：深空制图仪
//   深靛蓝的夜面 + 象牙白的受光面 + 一点黄铜色的信号
//   光源方向固定在世界之外，所以转动时晨昏线会"扫过"地球
// ----------------------------------------------------------
const SUN_DIR = { x: -0.72, y: -0.50, z: 0.45 };  // 太阳在世界里的方向（左上前方；z 越小夜面越大）
const SUN_DIST = 2.0;                             // 太阳离地心的距离（地球半径的倍数）
                                                  // 越小 → 夜面越大（像一盏近处的灯）；越大 → 白天越多
let L = { x: -0.68, y: -0.47, z: 0.56 };          // 归一化后的太阳方向（setup 里算）
let SUN_POS = { x: -1.36, y: -0.94, z: 1.12 };    // 太阳在视空间的位置（setup 里算）

// 月亮：放在屏幕暗面（右下），和太阳共用同一套「有限远点光源」光照
const MOON_DIR   = { x: 0.80, y: 0.60, z: 0.10 };  // 方向：右下暗面
const MOON_DIST  = 2.0;                            // 离地心距离（地球半径倍数，与太阳同距）
const MOON_R     = 0.27;                           // 半径（地球半径倍数；真实月地半径比 0.27）
const MOON_SWAY  = 3;                              // 缓慢摆动幅度（度）
const MOON_SWAY_PERIOD = 120;                      // 摆动周期（秒）
const MOON_STEP  = 3.7;                            // 月面采样精度（度）：和地球一样，点越密越实心
const MOON_DOT   = 1.55;                           // 月面像素点大小（按月亮屏幕半径轻微缩放）

// 月面点阵的灰度：与地球共用「分档批量绘制」的方法，颜色只做冷灰，不抢暖色信号
const MOON_BANDS = [
  "rgba(34, 39, 52, 0.30)",     // 夜面：只留极淡的球体轮廓
  "rgba(51, 57, 72, 0.48)",
  "rgba(72, 78, 94, 0.62)",     // 晨昏线
  "rgba(104, 108, 119, 0.78)",
  "rgba(143, 143, 143, 0.90)",  // 受光面：中灰
  "rgba(178, 176, 169, 0.96)"   // 正面高光：暖一点，但不发白
];
const N_MOON_BANDS = MOON_BANDS.length;

// 真实月海（selenographic 坐标）：这是让月亮"一眼是月亮"的关键
// rx / ry 是椭圆半径（度），已经按各自纬度做了经度压缩补偿
const MOON_MARIA = [
  { lat: 18,  lon: -57, rx: 30, ry: 22 },   // 风暴洋 Oceanus Procellarum
  { lat: 33,  lon: -16, rx: 15, ry: 14 },   // 雨海 Mare Imbrium
  { lat: 28,  lon: 17,  rx: 10, ry: 9  },   // 静海 Mare Serenitatis
  { lat: 8,   lon: 31,  rx: 12, ry: 10 },   // 宁静海 Mare Tranquillitatis
  { lat: 17,  lon: 59,  rx: 9,  ry: 8  },   // 危海 Mare Crisium
  { lat: -8,  lon: 51,  rx: 11, ry: 8  },   // 丰富海 Mare Fecunditatis
  { lat: -15, lon: 34,  rx: 6,  ry: 5  },   // 酒海 Mare Nectaris
  { lat: -21, lon: -17, rx: 10, ry: 9  },   // 云海 Mare Nubium
  { lat: -24, lon: -39, rx: 7,  ry: 6  },   // 湿海 Mare Humorum
  { lat: 13,  lon: 4,   rx: 5,  ry: 4  },   // 汽海 Mare Vaporum
  { lat: 56,  lon: 1,   rx: 22, ry: 4  },   // 冷海 Mare Frigoris
  { lat: 10,  lon: 21,  rx: 4,  ry: 3  }    // 澄海 Mare Serenitatis 南侧
];

let moonPhase = 0.92;                              // 照亮比例（给读数用）

// 人造卫星：轨道定义在「视空间」里，不随地球自转（物理上更对）
// r = 轨道半径（地球半径的倍数）· inc = 轨道倾角 · asc = 升交点方位
const ORBITS = [
  { r: 1.18, inc: 16,  asc: 0.30,  phase: 0.0, speed: 0.115 },
  { r: 1.38, inc: 64,  asc: -0.55, phase: 2.2, speed: 0.072 },
  { r: 1.62, inc: -36, asc: 1.15,  phase: 4.1, speed: 0.045 }
];
let orbitPts = [];

// 近地轨道空间站：独立于卫星，采用稳定的倾斜大圆轨道。
const STATION_ORBIT = { r: 1.28, inc: 51.6, asc: -0.28, phase: 0.9, speed: 0.0648 };
let stationOrbitPts = [];

// 绕着月球的两个人造卫星：一近一远，轨道倾斜不同，保持很小的尺度感。
const MOON_ORBITS = [
  { r: 1.30, inc: 27,  asc: 0.35,  phase: 0.4, speed: 0.095 },
  { r: 1.62, inc: -58, asc: -0.72, phase: 2.5, speed: 0.058 }
];
let moonOrbitPts = [];
const LAND_BANDS = [
  "rgba(40, 68, 106, 0.32)",    // 夜面：深靛蓝，还看得出轮廓
  "rgba(52, 88, 126, 0.44)",
  "rgba(62, 100, 140, 0.46)",   // 晨昏线
  "rgba(104, 146, 180, 0.66)",
  "rgba(168, 200, 220, 0.86)",  // 白天
  "rgba(233, 229, 218, 0.98)"   // 正对光源：象牙白
];
const SEA_BANDS = [
  "rgba(30, 54, 86, 0.22)",     // 夜面的海
  "rgba(48, 88, 130, 0.40)",
  "rgba(74, 134, 184, 0.62)"    // 受光面的海
];
const N_LAND_BANDS = LAND_BANDS.length;
const N_SEA_BANDS = SEA_BANDS.length;

// 吸积粒子按「吸附阶段 × 光照档位」批量绘制，避免 3200 个点逐点改颜色。
// 四组分别对应漂浮、初收束、近地表、已附着；每组三档光照。
const ARRIVAL_STYLES = [
  "rgba(88,132,184,0.24)",  "rgba(126,170,216,0.38)", "rgba(176,211,242,0.56)",
  "rgba(96,140,188,0.32)",  "rgba(144,184,220,0.48)", "rgba(198,224,246,0.68)",
  "rgba(124,154,180,0.44)", "rgba(178,200,214,0.62)", "rgba(222,228,224,0.78)",
  "rgba(50,82,124,0.54)",   "rgba(150,180,202,0.76)", "rgba(235,230,216,0.95)"
];
const N_ARRIVAL_STYLES = ARRIVAL_STYLES.length;
const GLOBE_RATIO = 0.34;   // 地球半径 = 屏幕短边 × 这个比例
const AUTO_SPIN   = 0.0006; // 自动自转速度（放慢一点，转太快容易眼晕；0 = 不自转）
const FOLLOW      = 5.0;    // 手移动时，地球跟手的比例 ← 最影响灵敏度
const FLICK       = 1.8;    // 松手后继续转的劲道（像用手拨地球仪）
const GLIDE       = 0.965;  // 手离开后惯性衰减：越接近 1 转得越久
const MOMENTUM    = 0.90;   // 手停下时保留多少「劲」（0.9 = 松手后还能滑一会儿）
const ZOOM_MIN    = 0.7;
const ZOOM_MAX    = 3.0;
const SPREAD_LO   = 0.15;   // 手势「收拢」时的运动范围（占画面比例）
const SPREAD_HI   = 0.80;   // 手势「张开」时的运动范围
const MOTION_MIN  = 35;     // 摄像头：多大像素变化算「动了」（调小更灵敏）
const DETECT_SCALE = 8;     // 摄像头检测精度：越小越精准、越吃性能
const MIN_MOTION  = 14;     // 至少要有这么多点算「手在动」——太小会被噪点骗
const VEL_SMOOTH  = 0.6;    // 速度平滑：越大越稳，越小越跟手
const DEADZONE    = 0.0008; // 死区：比这更小的动静直接忽略，画面不会自己抽
const MAX_STEP    = 0.20;   // 每帧最多转多少（防突然抽动）

// —— 手部识别（MediaPipe）——
const HAND_FOLLOW_X = 2.4;  // 手掌【左右】移动 → 转动（越大越灵敏，1.0 = 完全跟手）
const HAND_FOLLOW_Y = 1.0;  // 手掌【上下】移动 → 转动（灵敏度）
const INVERT_Y = -1;        // 上下方向：1 = 正常，-1 = 反过来（按 v 可随时切换）
const VICTORY_HOLD_MS = 420;  // 比耶手势保持多久才触发流星雨
const VICTORY_COOLDOWN_MS = 3500; // 手动触发后多久内不重复触发

// 手部静止稳定：不改变跟随灵敏度，只过滤微小抖动；放大后自动提高静止锁定。
const HAND_FILTER_MIN  = 0.22;   // 小幅抖动时的关键点平滑
const HAND_FILTER_MAX  = 0.82;   // 明确移动时保持跟手
const HAND_STILL_BASE  = 0.0009; // 普通倍率下的静止噪声区
const HAND_STILL_ZOOM  = 0.0028; // 放大后额外增加的静止区
const HAND_WAKE_MULT   = 1.7;    // 锁定后需要更大的移动才唤醒
const HAND_VERTICAL_NOISE   = 0.18; // 横向移动中低于这个比例的纵向分量视为噪声
const HAND_VERTICAL_RATIO   = 0.34; // 浅斜向需要连续同方向才放行
const HAND_VERTICAL_CONFIRM = 2;    // 浅斜向连续确认帧数
const HAND_FIELD_RADIUS_RATIO = 0.16; // 手掌对全屏粒子的排斥半径
const HAND_FIELD_PUSH_RATIO   = 0.08; // 最大排斥位移占屏幕短边比例
const HAND_FIVE_MOVE_LIMIT    = 0.0055; // 手掌平移超过它时暂停五指缩放
const HAND_FIVE_DEADZONE      = 0.004;  // 五指聚合度的最小有效变化
const HAND_FIVE_MAX_DELTA     = 0.080;  // 单帧最大聚合度变化，防止突然抽动
const HAND_FIVE_GAIN          = 7.0;    // 五指张开/收拢产生的缩放冲量
const HAND_FIVE_IMPULSE_STEP  = 0.065;  // 每次补完的最大缩放步长
const TRAIL_SPEED_MIN         = 0.35; // 开始拉长尾迹的旋转角速度
const TRAIL_SPEED_MAX         = 2.50; // 达到最大尾迹倍率的角速度

// ---------------- 状态 ----------------
let ptsLand = [];              // 陆地点（密）
let ptsSea = [];               // 海洋点（疏）
let moonPts = [];              // 月面点阵（一次生成，逐帧受光）
let arrivalParticles = [];     // 放大时从近地壳层吸附到陆地的粒子
let arrivalProgress = 0;       // 0 = 漂浮，1 = 全部附着
let arrivalCompleteLatch = false;
let arrivalRingT = -1;         // 收束完成光环的播放时间
let hasTexture = false;        // 有没有读到地球贴图
let rotX = -0.35, rotY = -1.8; // 视角：上下 / 左右（-1.8 ≈ 正对亚洲）
let spinX = 0, spinY = 0;      // 转速（松手后的惯性）
let silence = 0;               // 多久没检测到动作
let dragVX = 0, dragVY = 0;    // 鼠标拖拽的瞬时速度
let zoom = 1, zoomTarget = 1;
let autoSpin = true;
let dragging = false;
let mouseDownX = 0, mouseDownY = 0, mouseDownAt = 0, mouseMoved = false;
let cityFocus = null, cityFocusReturn = null;
let keyCityIndex = -1;
let handPinchClosed = false, lastHandPinchAt = 0, handPinchCycleUntil = 0;
let cityModeActive = false, cityModeLastSwitchAt = 0;
let cityModeSwipeArmed = true, cityModeStillFrames = 0;
let fivePinchExitFrames = 0;
let fivePinchArmedUntil = 0;
let fivePinchShakeAxis = -1, fivePinchShakeDir = 0, fivePinchShakeReversals = 0;
const observerLabelBoosts = {};
const _cityHitTargets = [];
let handFieldX = 0, handFieldY = 0, handFieldTargetX = 0, handFieldTargetY = 0;
let handFieldStrength = 0, handFieldTargetStrength = 0;
let lastFiveSpread = null;
let fiveZoomImpulse = 0;
let motionBoost = 0, prevRotX = rotX, prevRotY = rotY;
let stationPulseCity = "", stationPulseStart = 0, stationPulseUntil = 0;
let stationPulseLastGlobal = 0;
const stationPulseCooldown = {};
let routeFlashCity = "", routeFlashStart = 0, routeFlashUntil = 0;

let capture, videoEl, detect, dctx, prevData;
let camOn = true, cameraOk = false;
let motionCount = 0, spreadEMA = 0.3;
let motionVX = 0, motionVY = 0;   // 平滑后的运动速度
let lastCX = null, lastCY = null; // 上一帧的运动中心
let maskBuf = null;               // 运动掩码缓冲（复用，别每帧新建）

// 手部识别
let hands = null, handReady = false, handsBusy = false;
let handSeen = false, handCount = 0, lastHandFrame = -999;
let lastPalm = null, lastPalmFrame = 0;
let handZoom = null;
let lockedHandLabel = "";
let handSmoothX = null, handSmoothY = null;
let handStillLocked = false;
let handYSign = 0, handYSignFrames = 0;
let usingHandsNow = false;
let victoryGestureActive = false;
let victoryTriggered = false;
let victoryHoldStart = 0;
let victoryCooldownUntil = 0;
let victoryFeedbackUntil = 0;
let dtScale = 1;               // 帧率补偿：60fps 时 = 1，120fps 时 = 0.5
let cameraFps = 60;            // 实际渲染帧率（自己数的，给状态栏显示）
let lastDrawMs = 0;            // 上次真正渲染的时间
let fpsCount = 0, fpsT0 = 0;
const gRot = { R: 0, cx: 0, cy: 0, cr: 1, sr: 0, cyw: 1, syw: 0 };   // 本帧的投影参数
let followX = HAND_FOLLOW_X;   // 运行时的左右灵敏度（按 [ ] 随时调）
let invertY = INVERT_Y;        // 运行时的上下方向（按 v 切换）
let handFrames = 0;        // 识别库处理过的帧数（用来确认它真的在工作）
let handErrors = 0;        // 出错次数
let showDebug = false;

// 仪器元素：经纬网 / 赤道环 / 背景星 / 入场扫描
let ptsGrid = [], ptsRing = [], bgStars = [];
let starDust = [], meteors = [], showerMeteors = [], meteorSpawnQueue = [];
let meteorShower = null, meteorShowerNextAt = 0;
let revealT = 1;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LAND_BAND_BUFS = [], SEA_BAND_BUFS = [], MOON_BAND_BUFS = [], ARRIVAL_BAND_BUFS = [];
const LAND_BAND_N = new Array(N_LAND_BANDS).fill(0);
const SEA_BAND_N = new Array(N_SEA_BANDS).fill(0);
const MOON_BAND_N = new Array(N_MOON_BANDS).fill(0);
const ARRIVAL_BAND_N = new Array(N_ARRIVAL_STYLES).fill(0);
let readoutT = 0;

// ---------------- 国家 / 城市（想加就照着写） ----------------
const places = [
  { name: "北京",     lat: 39.90, lon: 116.40, type: "city" },
  { name: "上海",     lat: 31.23, lon: 121.47, type: "city" },
  { name: "香港",     lat: 22.32, lon: 114.17, type: "city" },
  { name: "东京",     lat: 35.68, lon: 139.69, type: "city" },
  { name: "新加坡",   lat: 1.35,  lon: 103.82, type: "city" },
  { name: "迪拜",     lat: 25.20, lon: 55.27,  type: "city" },
  { name: "伦敦",     lat: 51.51, lon: -0.13,  type: "city" },
  { name: "巴黎",     lat: 48.86, lon: 2.35,   type: "city" },
  { name: "纽约",     lat: 40.71, lon: -74.01, type: "city" },
  { name: "旧金山",   lat: 37.77, lon: -122.42, type: "city" },
  { name: "圣保罗",   lat: -23.55, lon: -46.63, type: "city" },
  { name: "悉尼",     lat: -33.87, lon: 151.21, type: "city" },
  { name: "达尔文",   lat: -12.46, lon: 130.84, type: "city" },
  { name: "凯恩斯",   lat: -16.92, lon: 145.77, type: "city" },
  { name: "开普敦",   lat: -33.92, lon: 18.42,  type: "city" },
  { name: "乌鲁木齐", lat: 43.83, lon: 87.62,  type: "city" },
  { name: "圣彼得堡", lat: 59.93, lon: 30.34,  type: "city" },
  { name: "中国",     lat: 35.0,  lon: 103.0,  type: "country" },
  { name: "美国",     lat: 39.0,  lon: -98.0,  type: "country" },
  { name: "日本",     lat: 36.2,  lon: 138.2,  type: "country" },
  { name: "英国",     lat: 54.0,  lon: -2.0,   type: "country" },
  { name: "法国",     lat: 46.6,  lon: 2.4,    type: "country" },
  { name: "澳大利亚", lat: -25.3, lon: 133.8,  type: "country" },
  { name: "巴西",     lat: -10.8, lon: -52.9,  type: "country" },
  { name: "印度",     lat: 22.0,  lon: 79.0,   type: "country" },
  { name: "俄罗斯",   lat: 61.5,  lon: 90.0,   type: "country" },
  { name: "埃及",     lat: 26.8,  lon: 30.8,   type: "country" },
  { name: "南非",     lat: -29.0, lon: 24.0,   type: "country" }
];

// 把状态写到页面左上角（也方便排查问题）
let _lastStatus = null, _lastCamStatus = null;

function setStatus(msg) {
  const text = msg || "";
  if (text === _lastStatus) return;          // 内容没变就不碰 DOM（120fps 下很重要）
  _lastStatus = text;
  const el = document.getElementById("warn");
  if (el) el.textContent = text;
}

function setCamStatus(msg) {
  const text = msg || "";
  if (text === _lastCamStatus) return;
  _lastCamStatus = text;
  const el = document.getElementById("rd-hand");
  if (el) el.textContent = text;
}

// ---------------- 夜面城市灯光 ----------------
// 只画光点、不标注（数据多一些，夜面才像真的）
const LIGHTS = [
  { name: "洛杉矶", lat: 34.05, lon: -118.24 },
  { name: "芝加哥", lat: 41.88, lon: -87.63 },
  { name: "多伦多", lat: 43.65, lon: -79.38 },
  { name: "墨西哥城", lat: 19.43, lon: -99.13 },
  { name: "波哥大", lat: 4.71, lon: -74.07 },
  { name: "利马", lat: -12.05, lon: -77.04 },
  { name: "布宜诺斯艾利斯", lat: -34.60, lon: -58.38 },
  { name: "里约", lat: -22.91, lon: -43.17 },
  { name: "拉各斯", lat: 6.52, lon: 3.38 },
  { name: "开罗", lat: 30.04, lon: 31.24 },
  { name: "内罗毕", lat: -1.29, lon: 36.82 },
  { name: "约翰内斯堡", lat: -26.20, lon: 28.05 },
  { name: "孟买", lat: 19.08, lon: 72.88 },
  { name: "德里", lat: 28.61, lon: 77.21 },
  { name: "卡拉奇", lat: 24.86, lon: 67.01 },
  { name: "曼谷", lat: 13.76, lon: 100.50 },
  { name: "雅加达", lat: -6.21, lon: 106.85 },
  { name: "首尔", lat: 37.57, lon: 126.98 },
  { name: "马尼拉", lat: 14.60, lon: 120.98 },
  { name: "莫斯科", lat: 55.75, lon: 37.62 },
  { name: "喀山", lat: 55.79, lon: 49.11 },
  { name: "叶卡捷琳堡", lat: 56.84, lon: 60.61 },
  { name: "新西伯利亚", lat: 55.03, lon: 82.92 },
  { name: "伊尔库茨克", lat: 52.28, lon: 104.28 },
  { name: "符拉迪沃斯托克", lat: 43.12, lon: 131.89 },
  { name: "兰州", lat: 36.06, lon: 103.83 },
  { name: "西宁", lat: 36.62, lon: 101.78 },
  { name: "银川", lat: 38.49, lon: 106.23 },
  { name: "喀什", lat: 39.47, lon: 75.99 },
  { name: "法兰克福", lat: 50.11, lon: 8.68 },
  { name: "伊斯坦布尔", lat: 41.01, lon: 28.98 },
  { name: "罗马", lat: 41.90, lon: 12.50 },
  { name: "柏林", lat: 52.52, lon: 13.40 },
  { name: "马德里", lat: 40.42, lon: -3.70 },
  { name: "阿姆斯特丹", lat: 52.37, lon: 4.90 },
  { name: "温哥华", lat: 49.28, lon: -123.12 },
  { name: "西雅图", lat: 47.61, lon: -122.33 },
  { name: "丹佛", lat: 39.74, lon: -104.99 },
  { name: "达拉斯", lat: 32.78, lon: -96.80 },
  { name: "休斯顿", lat: 29.76, lon: -95.37 },
  { name: "亚特兰大", lat: 33.75, lon: -84.39 },
  { name: "迈阿密", lat: 25.76, lon: -80.19 },
  { name: "华盛顿", lat: 38.91, lon: -77.04 },
  { name: "费城", lat: 39.95, lon: -75.17 },
  { name: "凤凰城", lat: 33.45, lon: -112.07 },
  { name: "拉斯维加斯", lat: 36.17, lon: -115.14 },
  { name: "波特兰", lat: 45.52, lon: -122.68 },
  { name: "明尼阿波利斯", lat: 44.98, lon: -93.27 },
  { name: "底特律", lat: 42.33, lon: -83.05 },
  { name: "奥兰多", lat: 28.54, lon: -81.38 },
  { name: "盐湖城", lat: 40.76, lon: -111.89 },
  { name: "檀香山", lat: 21.31, lon: -157.86 },
  { name: "安克雷奇", lat: 61.22, lon: -149.90 },
  { name: "波士顿", lat: 42.36, lon: -71.06 },
  { name: "蒙特利尔", lat: 45.50, lon: -73.57 },
  { name: "圣地亚哥", lat: -33.45, lon: -70.67 },
  { name: "加拉加斯", lat: 10.48, lon: -66.90 },
  { name: "巴塞罗那", lat: 41.39, lon: 2.17 },
  { name: "米兰", lat: 45.46, lon: 9.19 },
  { name: "维也纳", lat: 48.21, lon: 16.37 },
  { name: "华沙", lat: 52.23, lon: 21.01 },
  { name: "斯德哥尔摩", lat: 59.33, lon: 18.07 },
  { name: "雅典", lat: 37.98, lon: 23.73 },
  { name: "里斯本", lat: 38.72, lon: -9.14 },
  { name: "都柏林", lat: 53.35, lon: -6.26 },
  { name: "基辅", lat: 50.45, lon: 30.52 },
  { name: "卡萨布兰卡", lat: 33.57, lon: -7.59 },
  { name: "阿尔及尔", lat: 36.75, lon: 3.06 },
  { name: "亚的斯亚贝巴", lat: 9.03, lon: 38.74 },
  { name: "阿克拉", lat: 5.60, lon: -0.19 },
  { name: "达累斯萨拉姆", lat: -6.79, lon: 39.21 },
  { name: "德黑兰", lat: 35.69, lon: 51.39 },
  { name: "巴格达", lat: 33.31, lon: 44.37 },
  { name: "利雅得", lat: 24.71, lon: 46.68 },
  { name: "达卡", lat: 23.81, lon: 90.41 },
  { name: "科伦坡", lat: 6.93, lon: 79.86 },
  { name: "台北", lat: 25.03, lon: 121.57 },
  { name: "广州", lat: 23.13, lon: 113.26 },
  { name: "成都", lat: 30.57, lon: 104.07 },
  { name: "武汉", lat: 30.59, lon: 114.31 },
  { name: "西安", lat: 34.34, lon: 108.94 },
  { name: "吉隆坡", lat: 3.14, lon: 101.69 },
  { name: "河内", lat: 21.03, lon: 105.85 },
  { name: "胡志明市", lat: 10.82, lon: 106.63 },
  { name: "大阪", lat: 34.69, lon: 135.50 },
  { name: "名古屋", lat: 35.18, lon: 136.91 },
  { name: "釜山", lat: 35.18, lon: 129.08 },
  { name: "墨尔本", lat: -37.81, lon: 144.96 },
  { name: "布里斯班", lat: -27.47, lon: 153.03 },
  { name: "珀斯", lat: -31.95, lon: 115.86 },
  { name: "奥克兰", lat: -36.85, lon: 174.76 }
];

// 小城市 / 偏远城市的光点权重：1 = 默认，数值越小，光晕和核心点越小、亮度略低。
// 这里不需要录入所有城市，只标注需要和洲际枢纽拉开层级的地方。
const CITY_LIGHT_SCALE = {
  "喀什": 0.68, "西宁": 0.72, "银川": 0.74, "兰州": 0.84,
  "伊尔库茨克": 0.72, "符拉迪沃斯托克": 0.78, "新西伯利亚": 0.80,
  "喀山": 0.82, "叶卡捷琳堡": 0.84,
  "阿克拉": 0.82, "达累斯萨拉姆": 0.76, "亚的斯亚贝巴": 0.80,
  "内罗毕": 0.84, "卡萨布兰卡": 0.86, "阿尔及尔": 0.84,
  "加拉加斯": 0.82, "利马": 0.88, "波哥大": 0.86,
  "珀斯": 0.82, "布里斯班": 0.86, "奥克兰": 0.80,
  "费城": 0.94, "拉斯维加斯": 0.94, "波特兰": 0.90, "明尼阿波利斯": 0.90,
  "底特律": 0.92, "奥兰多": 0.90, "盐湖城": 0.84, "檀香山": 0.82, "安克雷奇": 0.76
};
let glowSprite = null;           // 预先画好的光晕贴图（比每帧新建渐变快）

// ---------------- 全球主干航线（真实存在的定期航线）----------------
// 两端必须都在 CITIES 查表里（places 的城市 + LIGHTS 的城市）
const ROUTES = [
  // 中国国内 10
  ["北京", "上海"], ["北京", "广州"], ["北京", "成都"], ["北京", "西安"], ["上海", "广州"],
  ["上海", "成都"], ["上海", "武汉"], ["广州", "成都"], ["成都", "武汉"], ["香港", "台北"],
  // 亚洲区内 12
  ["东京", "首尔"], ["大阪", "釜山"], ["东京", "大阪"], ["北京", "东京"], ["上海", "东京"],
  ["香港", "曼谷"], ["新加坡", "雅加达"], ["新加坡", "吉隆坡"], ["曼谷", "河内"], ["马尼拉", "香港"],
  ["孟买", "德里"], ["迪拜", "卡拉奇"],
  // 亚欧 12
  ["北京", "伦敦"], ["北京", "巴黎"], ["北京", "莫斯科"], ["上海", "巴黎"], ["上海", "阿姆斯特丹"],
  ["上海", "米兰"], ["香港", "伦敦"], ["东京", "伦敦"], ["首尔", "巴黎"], ["新加坡", "伦敦"],
  ["德里", "伦敦"], ["迪拜", "伦敦"],
  // 跨太平洋 10
  ["北京", "洛杉矶"], ["上海", "洛杉矶"], ["上海", "旧金山"], ["香港", "旧金山"], ["台北", "旧金山"],
  ["东京", "洛杉矶"], ["东京", "纽约"], ["首尔", "洛杉矶"], ["新加坡", "旧金山"], ["悉尼", "洛杉矶"],
  // 跨大西洋 8
  ["伦敦", "纽约"], ["巴黎", "纽约"], ["罗马", "纽约"], ["阿姆斯特丹", "纽约"], ["马德里", "迈阿密"],
  ["柏林", "纽约"], ["都柏林", "波士顿"], ["里斯本", "纽约"],
  // 美洲区内 8
  ["纽约", "芝加哥"], ["纽约", "迈阿密"], ["纽约", "多伦多"], ["洛杉矶", "西雅图"], ["达拉斯", "墨西哥城"],
  ["圣保罗", "里约"], ["布宜诺斯艾利斯", "圣地亚哥"], ["利马", "波哥大"],
  // 美国：补足主要枢纽的跨州、跨洋与亚太航线
  ["凤凰城", "洛杉矶"], ["凤凰城", "纽约"], ["凤凰城", "芝加哥"], ["凤凰城", "西雅图"],
  ["拉斯维加斯", "洛杉矶"], ["拉斯维加斯", "纽约"], ["拉斯维加斯", "芝加哥"], ["拉斯维加斯", "西雅图"],
  ["波特兰", "西雅图"], ["波特兰", "旧金山"], ["波特兰", "洛杉矶"], ["波特兰", "纽约"],
  ["明尼阿波利斯", "芝加哥"], ["明尼阿波利斯", "纽约"], ["明尼阿波利斯", "洛杉矶"], ["明尼阿波利斯", "西雅图"],
  ["底特律", "芝加哥"], ["底特律", "纽约"], ["底特律", "亚特兰大"],
  ["奥兰多", "纽约"], ["奥兰多", "亚特兰大"], ["奥兰多", "迈阿密"], ["奥兰多", "洛杉矶"],
  ["盐湖城", "丹佛"], ["盐湖城", "洛杉矶"], ["盐湖城", "西雅图"],
  ["檀香山", "洛杉矶"], ["檀香山", "旧金山"], ["檀香山", "西雅图"], ["檀香山", "东京"],
  ["安克雷奇", "西雅图"], ["安克雷奇", "洛杉矶"], ["安克雷奇", "东京"],
  ["费城", "纽约"], ["费城", "芝加哥"], ["费城", "波士顿"], ["费城", "迈阿密"],
  ["凤凰城", "伦敦"], ["奥兰多", "伦敦"], ["费城", "伦敦"],
  ["明尼阿波利斯", "阿姆斯特丹"], ["底特律", "阿姆斯特丹"],

  // 非洲 / 中东 10
  ["开罗", "迪拜"], ["开罗", "伊斯坦布尔"], ["约翰内斯堡", "开普敦"], ["约翰内斯堡", "伦敦"], ["拉各斯", "阿克拉"],
  ["内罗毕", "亚的斯亚贝巴"], ["达累斯萨拉姆", "迪拜"], ["卡萨布兰卡", "巴黎"], ["阿尔及尔", "巴黎"], ["拉各斯", "伦敦"],
  // 大洋洲 + 中国沿海补线（让这些区域放大后也有航班）
  ["悉尼", "墨尔本"], ["悉尼", "布里斯班"], ["墨尔本", "珀斯"], ["悉尼", "奥克兰"], ["珀斯", "新加坡"],
  ["北京", "香港"], ["上海", "香港"], ["北京", "武汉"], ["广州", "西安"], ["上海", "西安"],

  // 澳大利亚北部：达尔文与凯恩斯两个门户城市
  ["达尔文", "悉尼"], ["达尔文", "墨尔本"], ["达尔文", "布里斯班"], ["达尔文", "珀斯"],
  ["达尔文", "新加坡"], ["凯恩斯", "悉尼"], ["凯恩斯", "墨尔本"], ["凯恩斯", "布里斯班"],

  // 中国西北：真实的国内主干线与区域支线
  ["乌鲁木齐", "北京"], ["乌鲁木齐", "上海"], ["乌鲁木齐", "广州"], ["乌鲁木齐", "成都"],
  ["乌鲁木齐", "西安"], ["乌鲁木齐", "兰州"], ["乌鲁木齐", "喀什"], ["兰州", "北京"],
  ["兰州", "上海"], ["兰州", "广州"], ["西宁", "北京"], ["西宁", "上海"],
  ["银川", "北京"], ["银川", "西安"],

  // 俄罗斯：莫斯科放射 + 西伯利亚/远东主航线
  ["莫斯科", "圣彼得堡"], ["莫斯科", "喀山"], ["莫斯科", "叶卡捷琳堡"], ["莫斯科", "新西伯利亚"],
  ["莫斯科", "伊尔库茨克"], ["莫斯科", "符拉迪沃斯托克"], ["新西伯利亚", "伊尔库茨克"],
  ["伊尔库茨克", "符拉迪沃斯托克"],

  // 香港：按真实枢纽航线补足全球方向
  ["香港", "新加坡"], ["香港", "吉隆坡"], ["香港", "雅加达"], ["香港", "东京"],
  ["香港", "首尔"], ["香港", "迪拜"], ["香港", "德里"], ["香港", "孟买"],
  ["香港", "巴黎"], ["香港", "阿姆斯特丹"], ["香港", "法兰克福"], ["香港", "伊斯坦布尔"],
  ["香港", "纽约"], ["香港", "洛杉矶"], ["香港", "芝加哥"], ["香港", "波士顿"],
  ["香港", "温哥华"], ["香港", "多伦多"], ["香港", "悉尼"], ["香港", "墨尔本"],
  ["香港", "布里斯班"], ["香港", "珀斯"], ["香港", "奥克兰"],

  // 新加坡：按真实枢纽航线补足全球方向
  ["新加坡", "北京"], ["新加坡", "上海"], ["新加坡", "广州"], ["新加坡", "东京"],
  ["新加坡", "首尔"], ["新加坡", "曼谷"], ["新加坡", "马尼拉"], ["新加坡", "河内"],
  ["新加坡", "孟买"], ["新加坡", "德里"], ["新加坡", "迪拜"], ["新加坡", "伊斯坦布尔"],
  ["新加坡", "巴黎"], ["新加坡", "阿姆斯特丹"], ["新加坡", "法兰克福"], ["新加坡", "纽约"],
  ["新加坡", "洛杉矶"], ["新加坡", "西雅图"], ["新加坡", "悉尼"], ["新加坡", "墨尔本"],
  ["新加坡", "布里斯班"], ["新加坡", "奥克兰"], ["新加坡", "约翰内斯堡"]
];

let CITIES = {};                 // 城市查表 name → {lat, lon}
let LABELED_CITY_NAMES = {};     // places 里已经有主标注的城市
const _markerLabelRects = [];    // 当前帧已占用文字区域，用于放大后的标签避让
let routePaths = [];             // 每条航线的几何与航班
let auroraN = [], auroraS = [];  // 南北极光带
let forceFlights = false;        // 按 f 强制显示航线
let flightCount = 0;             // 本帧朝向屏幕一侧的航班数（给读数用）

// ---------------- 只跑一次 ----------------
function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  frameRate(TARGET_FPS);  // 想改帧率就改上面的 TARGET_FPS
  colorMode(RGB, 255, 255, 255, 255);

  // 归一化光方向：光照和太阳位置用的是同一个方向，所以晨昏线一定对着太阳
  const n = Math.hypot(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
  L = { x: SUN_DIR.x / n, y: SUN_DIR.y / n, z: SUN_DIR.z / n };
  SUN_POS = { x: L.x * SUN_DIST, y: L.y * SUN_DIST, z: L.z * SUN_DIST };

  buildGlowSprite();
  buildMoonPoints();
  buildOrbits();
  buildStationOrbit();
  buildMoonOrbits();
  buildCities();
  buildRoutes();
  buildAurora();
  buildGraticulePoints();
  buildRing();
  buildStars();
  revealT = reduceMotion ? 1 : 0;      // 尊重系统的"减少动态效果"设置
  buildLandTexture();     // 读 assets/earth.jpg（读不到就退化成网格地球）
  setupCamera();
  setupDetect();
  initHands();            // 启动手部识别（不在线，全部读本地文件）
  fpsT0 = millis();

  background(6, 9, 15);
}

// 读贴图 → 得到「哪些经纬度是陆地」
function buildLandTexture() {
  const img = new Image();
  img.onload = () => readLand(img);
  img.onerror = () => { hasTexture = false; buildGraticule(); };
  img.src = "assets/earth.jpg";
}

function readLand(img) {
  const W = 1440, H = 720;                // 采样分辨率：越大海岸线越准（0.25°/像素）
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, W, H);

  let data;
  try {
    data = cx.getImageData(0, 0, W, H).data;
  } catch (e) {
    hasTexture = false;
    setStatus("⚠️ 贴图读取失败（可能不是用 Live Server 打开的）");
    buildGraticule();
    return;
  }

  // 判断某个经纬度是陆地还是海
  const isLand = (lat, lon) => {
    const px = Math.floor(((lon + 180) / 360) * W) % W;
    const py = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    const i = (py * W + px) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // 海水偏蓝（蓝比红高出一截）；陆地偏绿/棕/白。北极圈那片海冰按海处理
    return lat <= 76 && (b - r) <= 28 && lum > 25;
  };

  ptsLand = [];
  ptsSea = [];

  // 陆地：密
  for (let lat = -88; lat <= 88; lat += DOT_STEP) {
    const cosLat = Math.max(0.12, Math.cos(radians(lat)));
    const stepLon = Math.min(DOT_STEP / cosLat, 24);
    for (let lon = -180; lon < 180; lon += stepLon) {
      if (isLand(lat, lon)) {
        const pt = toXYZ(lat, lon);
        pt.s = random(0.87, 1.13);        // 每个点大小略有差异 → 网格不规则，不闪

        // 周围采样到海水的陆地点视为海岸点，吸附时优先到达。
        const nLat = DOT_STEP * 1.1;
        const nLon = Math.min(DOT_STEP * 1.1 / cosLat, 24);
        pt.coast = false;
        for (let da = -1; da <= 1 && !pt.coast; da++) {
          for (let db = -1; db <= 1; db++) {
            if (!isLand(lat + da * nLat, lon + db * nLon)) {
              pt.coast = true;
              break;
            }
          }
        }
        ptsLand.push(pt);
      }
    }
  }

  // 海洋：疏
  for (let lat = -88; lat <= 88; lat += SEA_STEP) {
    const cosLat = Math.max(0.12, Math.cos(radians(lat)));
    const stepLon = Math.min(SEA_STEP / cosLat, 30);
    for (let lon = -180; lon < 180; lon += stepLon) {
      if (!isLand(lat, lon)) {
        const pt = toXYZ(lat, lon);
        pt.s = random(0.8, 1.2);
        ptsSea.push(pt);
      }
    }
  }

  hasTexture = true;
  buildArrivalParticles();
  setStatus("陆地 " + ptsLand.length + " 点 · 海洋 " + ptsSea.length + " 点 · 贴图已加载");
}

// 没有贴图时：画一层经纬网点，至少还是个球
function buildGraticule() {
  setStatus("⚠️ 没读到 assets/earth.jpg，先画成网格地球");
  ptsLand = [];
  ptsSea = [];
  for (let lat = -80; lat <= 80; lat += 6) {
    const cosLat = Math.max(0.15, Math.cos(radians(lat)));
    for (let lon = -180; lon < 180; lon += 6 / cosLat) {
      const pt = toXYZ(lat, lon);
      pt.s = random(0.8, 1.2);
      ptsSea.push(pt);
    }
  }
  arrivalParticles = [];
}

function buildArrivalParticles() {
  arrivalParticles = [];
  arrivalProgress = 0;
  arrivalCompleteLatch = false;
  arrivalRingT = -1;
  if (!ptsLand.length) return;

  for (let i = 0; i < ARRIVAL_COUNT; i++) {
    const target = ptsLand[Math.floor(i * ptsLand.length / ARRIVAL_COUNT)];
    const coast = !!target.coast;
    arrivalParticles.push({
      tx: target.x, ty: target.y, tz: target.z,
      fx: random(-ARRIVAL_SCREEN_MARGIN, 1 + ARRIVAL_SCREEN_MARGIN),
      fy: random(-ARRIVAL_SCREEN_MARGIN, 1 + ARRIVAL_SCREEN_MARGIN),
      dx: random(-1, 1) * ARRIVAL_FLOAT_DRIFT,
      dy: random(-1, 1) * ARRIVAL_FLOAT_DRIFT,
      delay: coast ? random(0, 0.25) : random(0.30, 0.80),
      phase: random(TWO_PI),
      driftSpeed: random(0.18, 0.48),
      s: random(0.90, 1.35)
    });
  }
}

// 经纬度 → 单位球坐标（y 轴向下，和屏幕一致）
function toXYZ(lat, lon) {
  const a = radians(lat), b = radians(lon);
  return {
    x: Math.cos(a) * Math.sin(b),
    y: -Math.sin(a),
    z: Math.cos(a) * Math.cos(b)
  };
}


/* 月面点阵：一次生成球面上的采样点，月海只改变这些点的表面灰度 */
function moonHash(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function lunarMaria(lat, lon) {
  let shade = 0;
  for (let i = 0; i < MOON_MARIA.length; i++) {
    const m = MOON_MARIA[i];
    let dLon = lon - m.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const d = (dLon * dLon) / (m.rx * m.rx) + ((lat - m.lat) * (lat - m.lat)) / (m.ry * m.ry);
    if (d < 1) shade = Math.max(shade, 1 - d);
  }
  return shade;
}

function buildMoonPoints() {
  moonPts = [];
  for (let lat = -88; lat <= 88; lat += MOON_STEP) {
    const cosLat = Math.max(0.12, Math.cos(radians(lat)));
    const stepLon = Math.min(MOON_STEP / cosLat, 24);
    for (let lon = -180; lon < 180; lon += stepLon) {
      const p = toXYZ(lat, lon);
      p.tone = 0.88 + 0.17 * moonHash(lat + 11.3, lon - 7.1);
      p.s = 0.78 + 0.34 * moonHash(lat - 3.7, lon + 19.2);
      p.maria = lunarMaria(lat, lon);
      moonPts.push(p);
    }
  }
}

/* 月亮：和地球同一种像素点阵语言；每个点都在球面上，逐点受太阳照明 */
function drawMoon(ctx) {
  // 极缓慢摆动：绕视空间 Z 轴转 ±MOON_SWAY 度
  const sway = radians(MOON_SWAY) * Math.sin(millis() / 1000 * TWO_PI / MOON_SWAY_PERIOD);
  const cs = Math.cos(sway), sn = Math.sin(sway);
  const dx = MOON_DIR.x * cs - MOON_DIR.y * sn;
  const dy = MOON_DIR.x * sn + MOON_DIR.y * cs;
  const dz = MOON_DIR.z;
  const dn = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const center = { x: dx / dn * MOON_DIST, y: dy / dn * MOON_DIST, z: dz / dn * MOON_DIST };

  // 月相读数：平行光下只由太阳相对镜头的方向决定
  moonPhase = (1 + L.z) / 2;

  const Rz = gRot.R * zoom;
  const cq = projectView(center, Rz, gRot.cx, gRot.cy);
  const mx = cq.x, my = cq.y;
  const moonR = Math.max(6, MOON_R * Rz / (1 + (1 - center.z) * 0.3));
  const baseX = center.x;
  const baseY = center.y;
  const baseZ = center.z;

  // 先画月球轨道和卫星的后半段；月球本体会遮住它后面的部分。
  drawMoonSatelliteLayer(ctx, mx, my, moonR, false);

  // ① 极淡的光晕：只给暗面一点空气感，不做发光贴纸
  const halo = ctx.createRadialGradient(mx, my, moonR * 0.92, mx, my, moonR * 2.15);
  halo.addColorStop(0, "rgba(196,202,216,0.035)");
  halo.addColorStop(1, "rgba(178,190,214,0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(mx, my, moonR * 2.15, 0, TWO_PI); ctx.fill();

  // ② 极暗的球体底：只是防止星点穿过月面，真正的体积由点阵组成
  const body = ctx.createRadialGradient(
    mx + L.x * moonR * 0.20, my + L.y * moonR * 0.20, 0,
    mx, my, moonR * 1.04
  );
  body.addColorStop(0.00, "rgba(25, 29, 38, 0.34)");
  body.addColorStop(0.72, "rgba(12, 16, 25, 0.54)");
  body.addColorStop(1.00, "rgba(5,  8, 15, 0.72)");
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(mx, my, moonR, 0, TWO_PI); ctx.fill();

  // ③ 一次投影，把月面点按受光强度分档；每档只设一次颜色，和地球完全同构
  for (let b = 0; b < N_MOON_BANDS; b++) {
    if (!MOON_BAND_BUFS[b] || MOON_BAND_BUFS[b].length < moonPts.length * 3) {
      MOON_BAND_BUFS[b] = new Float32Array(moonPts.length * 3);
    }
    MOON_BAND_N[b] = 0;
  }

  const dotBase = MOON_DOT * constrain(moonR / 68, 0.72, 1.38);
  for (let i = 0; i < moonPts.length; i++) {
    const p = moonPts[i];
    if (p.z <= 0.015) continue;                    // 只画朝向镜头的一面

    // 月面点在视空间里真正处在球面上，所以球的体积来自几何，不来自贴图
    const wx = baseX + p.x * MOON_R;
    const wy = baseY + p.y * MOON_R;
    const wz = baseZ + p.z * MOON_R;
    const depth = 1 + (1 - wz) * 0.3;
    const sx = gRot.cx + wx * Rz / depth;
    const sy = gRot.cy + wy * Rz / depth;
    if (sx < -8 || sx > width + 8 || sy < -8 || sy > height + 8) continue;

    // 太阳对每一颗月面点的入射角都不同，点的明暗自然汇成月相和晨昏线
    const lx = SUN_POS.x - wx;
    const ly = SUN_POS.y - wy;
    const lz = SUN_POS.z - wz;
    const invL = 1 / Math.sqrt(lx * lx + ly * ly + lz * lz);
    const lam = (p.x * lx + p.y * ly + p.z * lz) * invL;

    // 月海不是一块块贴上去的暗斑，而是让落在月海范围内的点自然变暗、略缩
    const surface = p.tone * (1 - p.maria * 0.54);
    const limb = 0.86 + 0.14 * p.z;               // 球缘稍微收一点，体积更稳
    const lum = constrain(lam * 0.5 + 0.5, 0, 1) * surface * limb;
    let band = Math.floor(lum * N_MOON_BANDS);
    if (band >= N_MOON_BANDS) band = N_MOON_BANDS - 1;

    const size = dotBase * p.s * (0.84 + 0.16 * p.z) * (1 - p.maria * 0.16);
    const buf = MOON_BAND_BUFS[band];
    const k = MOON_BAND_N[band];
    buf[k] = sx; buf[k + 1] = sy; buf[k + 2] = size;
    MOON_BAND_N[band] = k + 3;
  }

  drawBands(ctx, MOON_BAND_BUFS, MOON_BAND_N, MOON_BANDS);
  drawMoonSatelliteLayer(ctx, mx, my, moonR, true);
}

function drawMoonSatelliteLayer(ctx, mx, my, moonR, frontPass) {
  const t = millis() / 1000;
  const FRONT = "rgba(158,190,222,0.22)";
  const BACK = "rgba(150,182,214,0.08)";

  // 轨道线：前半段画在月球上方，后半段画在月球下方。
  for (let oi = 0; oi < moonOrbitPts.length; oi++) {
    const list = moonOrbitPts[oi];
    for (let i = 0; i < list.length; i++) {
      const q = projectView(list[i], moonR, mx, my);
      const inside = Math.hypot(q.x - mx, q.y - my) < moonR * 0.98;
      if (frontPass) {
        if (q.z < 0) continue;
      } else {
        if (q.z >= 0 || inside) continue;
      }
      ctx.fillStyle = frontPass ? FRONT : BACK;
      ctx.fillRect(q.x, q.y, 1, 1);
    }
  }

  // 卫星本体与短尾迹：两颗都用现有黄铜信号，但比地球卫星更小。
  for (let oi = 0; oi < MOON_ORBITS.length; oi++) {
    const o = MOON_ORBITS[oi];
    const th = o.phase + t * o.speed;

    for (let k = 6; k >= 1; k--) {
      const pp = orbitPoint(o, th - k * 0.022);
      const qq = projectView(pp, moonR, mx, my);
      const inside = Math.hypot(qq.x - mx, qq.y - my) < moonR * 0.98;
      if (frontPass) {
        if (qq.z < 0) continue;
      } else {
        if (qq.z >= 0 || inside) continue;
      }
      const lit = satLight(pp);
      const a = 0.25 * (1 - k / 7) * lit;
      if (a <= 0.008) continue;
      ctx.fillStyle = "rgba(227,160,76," + a.toFixed(3) + ")";
      ctx.fillRect(qq.x, qq.y, 1, 1);
    }

    const p = orbitPoint(o, th);
    const q = projectView(p, moonR, mx, my);
    const inside = Math.hypot(q.x - mx, q.y - my) < moonR * 0.98;
    if (frontPass) {
      if (q.z < 0) continue;
    } else {
      if (q.z >= 0 || inside) continue;
    }

    const lit = satLight(p);
    const glowR = 4.5;
    const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, glowR);
    g.addColorStop(0, "rgba(255,216,156," + (0.34 * lit).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,200,130,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, glowR, 0, TWO_PI); ctx.fill();

    ctx.fillStyle = "rgba(255,240,208," + (0.90 * lit).toFixed(3) + ")";
    ctx.fillRect(q.x - 0.9, q.y - 0.9, 1.8, 1.8);
  }
}


/* 城市灯光的光晕贴图：画一次，之后每帧只 drawImage */
function buildGlowSprite() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rad.addColorStop(0.00, "rgba(255, 232, 186, 1)");
  rad.addColorStop(0.16, "rgba(255, 200, 128, 0.55)");
  rad.addColorStop(0.42, "rgba(240, 160, 84, 0.16)");
  rad.addColorStop(1.00, "rgba(230, 150, 70, 0)");
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);
  glowSprite = c;
}

/* 某个点的受光量（-1 全暗 ~ +1 正对光源）
   光源离得不远，所以每个点的光照方向都不同 —— 这会让晨昏线往受光面推，夜面更大 */
function lamAt(q) {
  const dx = SUN_POS.x - q.rx, dy = SUN_POS.y - q.ry, dz = SUN_POS.z - q.z;
  const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
  return (q.rx * dx + q.ry * dy + q.z * dz) * inv;
}

/* 轨道上的一点：先画赤道面上的圆，再倾斜、再转方位 */
function orbitPoint(o, t) {
  const x0 = Math.cos(t) * o.r;
  const z0 = Math.sin(t) * o.r;
  const inc = radians(o.inc);
  const y1 = -z0 * Math.sin(inc);
  const z1 = z0 * Math.cos(inc);
  const ca = Math.cos(o.asc), sa = Math.sin(o.asc);
  return { x: x0 * ca + z1 * sa, y: y1, z: -x0 * sa + z1 * ca };
}

function buildOrbits() {
  orbitPts = ORBITS.map(function (o) {
    const list = [];
    for (let a = 0; a < 360; a += 2) list.push(orbitPoint(o, radians(a)));
    return list;
  });
}

function buildStationOrbit() {
  stationOrbitPts = [];
  for (let a = 0; a < 360; a += 2) stationOrbitPts.push(orbitPoint(STATION_ORBIT, radians(a)));
}

function buildMoonOrbits() {
  moonOrbitPts = MOON_ORBITS.map(function (o) {
    const list = [];
    for (let a = 0; a < 360; a += 2) list.push(orbitPoint(o, radians(a)));
    return list;
  });
}

/* 视空间投影：不加 rotX / rotY（卫星不跟地球一起转） */
const _qv = { x: 0, y: 0, z: 0 };
function projectView(p, R, cx, cy) {
  const depth = 1 + (1 - p.z) * 0.3;
  _qv.x = cx + (p.x * R) / depth;
  _qv.y = cy + (p.y * R) / depth;
  _qv.z = p.z;
  return _qv;
}

/* 经纬网：仪器的刻度，每 30° 一条 */
function buildGraticulePoints() {
  ptsGrid = [];
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -88; lat <= 88; lat += 3) ptsGrid.push(toXYZ(lat, lon));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const cosLat = Math.max(0.16, Math.cos(radians(lat)));
    for (let lon = -180; lon < 180; lon += 3 / cosLat) ptsGrid.push(toXYZ(lat, lon));
  }
}

/* 赤道环：稍微在球外一点，像仪器的赤道圈 */
function buildRing() {
  ptsRing = [];
  const r = 1.05;
  for (let a = 0; a < 360; a += 2) {
    ptsRing.push({ x: Math.cos(radians(a)) * r, y: 0, z: Math.sin(radians(a)) * r });
  }
}

/* 背景星：大部分静止，只让少量星点以很慢的不同相位轻微起伏。 */
function buildStars() {
  bgStars = [];
  starDust = [];
  meteors = [];
  showerMeteors = [];
  meteorShower = null;
  meteorSpawnQueue = [];
  hideMeteorShowerLabel();

  const twinkleStride = Math.max(1, Math.round(150 / STAR_TWINKLE_COUNT));
  for (let i = 0; i < 150; i++) {
    const twinkle = i % twinkleStride === 0;
    bgStars.push({
      x: random(width), y: random(height),
      a: random(0.05, 0.28),
      s: random() < 0.86 ? 1 : 1.5,
      tw: twinkle ? random(STAR_TWINKLE_DEPTH_MIN, STAR_TWINKLE_DEPTH_MAX) : 0,
      tp: random(STAR_TWINKLE_PERIOD_MIN, STAR_TWINKLE_PERIOD_MAX),
      ph: random(TWO_PI)
    });
  }

  for (let i = 0; i < STAR_DUST_COUNT; i++) {
    const speed = random(STAR_DUST_SPEED_MIN, STAR_DUST_SPEED_MAX);
    starDust.push({
      x: random(width), y: random(height),
      vx: speed * 0.90, vy: speed * 0.42,
      a: random(0.015, 0.045)
    });
  }

  // 首颗只等一小会儿，之后恢复为 20~34 秒的稀有节奏。
  meteorSpawnQueue.push(millis() / 1000 + random(METEOR_FIRST_MIN, METEOR_FIRST_MAX));
  meteorShowerNextAt = millis() / 1000 + random(SHOWER_FIRST_MIN, SHOWER_FIRST_MAX);
}

function showerIntensity(now) {
  if (!meteorShower) return 0;
  const ramp = smoothStep01((now - meteorShower.startAt) / SHOWER_RAMP_SECONDS);
  const taper = smoothStep01((meteorShower.endAt - now) / SHOWER_TAPER_SECONDS);
  return Math.min(ramp, taper);
}

/* 星尘和流星都是屏幕空间背景：不跟地球旋转，只提供轻微纵深。 */
function updateBackground(dtSec, cx, cy, earthR) {
  if (reduceMotion) return;

  for (let i = 0; i < starDust.length; i++) {
    const d = starDust[i];
    d.x += d.vx * dtSec;
    d.y += d.vy * dtSec;
    if (d.x > width + 4) d.x = -4;
    if (d.y > height + 4) d.y = -4;
  }

  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.age += dtSec;
    const liveDuration = m.duration / Math.max(0.1, m.speedScale || 1);
    if (m.age >= liveDuration + m.afterglow) meteors.splice(i, 1);
  }
  for (let i = showerMeteors.length - 1; i >= 0; i--) {
    const m = showerMeteors[i];
    m.age += dtSec;
    const liveDuration = m.duration / Math.max(0.1, m.speedScale || 1);
    if (m.age >= liveDuration + m.afterglow) showerMeteors.splice(i, 1);
  }

  const now = millis() / 1000;

  // 流星雨期间暂停普通流星，避免两类事件叠在一起。
  if (meteorShower && now >= meteorShower.endAt) {
    meteorShower = null;
    hideMeteorShowerLabel();
  }
  if (!meteorShower && now >= meteorShowerNextAt) {
    startMeteorShower(now);
    meteorShowerNextAt = now + random(SHOWER_GAP_MIN, SHOWER_GAP_MAX);
  }
  if (meteorShower && now >= meteorShower.nextSpawnAt) {
    const intensity = showerIntensity(now);
    let spawned = 0;
    while (meteorShower && intensity > 0.04 && now >= meteorShower.nextSpawnAt &&
           showerMeteors.length < SHOWER_MAX_ACTIVE && spawned < 2) {
      if (spawnShowerMeteor(now, cx, cy, earthR)) spawned++;
      meteorShower.nextSpawnAt += random(SHOWER_SPAWN_MIN, SHOWER_SPAWN_MAX) / Math.max(0.20, intensity);
    }
  }

  while (meteorSpawnQueue.length && meteorSpawnQueue[0] <= now) {
    meteorSpawnQueue.shift();
    const created = !meteorShower && meteors.length < METEOR_MAX_ACTIVE && spawnMeteor(cx, cy, earthR);

    // 每次事件后安排下一颗；偶尔在同一次事件里补一颗错开的流星。
    meteorSpawnQueue.push(now + random(METEOR_GAP_MIN, METEOR_GAP_MAX));
    if (created && meteors.length < METEOR_MAX_ACTIVE && random() < METEOR_PAIR_CHANCE) {
      meteorSpawnQueue.push(now + random(0.8, 2.0));
    }
    meteorSpawnQueue.sort((a, b) => a - b);
  }
}

function startMeteorShower(now, manual) {
  if (!reduceMotion) showMeteorShowerLabel();
  meteorShower = {
    startAt: now,
    endAt: now + random(SHOWER_DURATION_MIN, SHOWER_DURATION_MAX),
    nextSpawnAt: now + random(0.05, 0.22),
    fromLeft: random() < 0.5,
    angle: radians(random(27, 41)),
    manual: !!manual,
    goldBoostUntil: manual ? now + SHOWER_GOLD_OPENING_SEC : 0
  };
}

/* 短、长、超长三档：短流星保留，长流星跨越大半屏，超长接近整屏对角线。 */
function chooseMeteorStyle(isShower) {
  const diag = Math.hypot(width, height);
  const r = random();
  const ultraChance = isShower ? SHOWER_ULTRA_CHANCE : METEOR_ULTRA_CHANCE;
  const longChance = isShower ? SHOWER_LONG_CHANCE : METEOR_LONG_CHANCE;

  if (r < ultraChance) {
    return {
      kind: 2,
      len: diag * random(METEOR_ULTRA_RATIO_MIN, METEOR_ULTRA_RATIO_MAX),
      duration: random(isShower ? 1.5 : 1.8, isShower ? 2.3 : 2.8),
      scale: random(isShower ? 1.12 : 1.20, 1.65),
      trailRatio: 0.42
    };
  }
  if (r < ultraChance + longChance) {
    return {
      kind: 1,
      len: diag * random(METEOR_LONG_RATIO_MIN, METEOR_LONG_RATIO_MAX),
      duration: random(isShower ? 1.1 : 1.3, isShower ? 1.7 : 2.0),
      scale: random(isShower ? 0.88 : 0.95, isShower ? 1.18 : 1.35),
      trailRatio: 0.50
    };
  }
  return {
    kind: 0,
    len: random(isShower ? 130 : METEOR_LENGTH_MIN, isShower ? 270 : METEOR_LENGTH_MAX),
    duration: isShower ? random(0.75, 1.25) : random(METEOR_DURATION_MIN, METEOR_DURATION_MAX),
    scale: isShower
      ? random(SHOWER_SCALE_MIN, SHOWER_SCALE_MAX)
      : random(METEOR_SCALE_MIN, METEOR_SCALE_MAX),
    trailRatio: 0.62
  };
}

function showerPathVisible(x0, y0, cx, cy, x1, y1, earthCx, earthCy, earthR) {
  const samples = 14;
  let visible = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    if (Math.hypot(x - earthCx, y - earthCy) > earthR * 0.96) visible++;
  }
  return visible >= 4;
}

function spawnShowerMeteor(now, earthCx, earthCy, earthR) {
  if (earthR > Math.min(width, height) * 0.60) return false;

  for (let attempt = 0; attempt < 12; attempt++) {
    let nearCount = 0, farCount = 0;
    for (let i = 0; i < showerMeteors.length; i++) {
      if (showerMeteors[i].layer === "far") farCount++;
      else nearCount++;
    }
    const layer = (nearCount < SHOWER_NEAR_MAX_ACTIVE &&
      (farCount >= SHOWER_FAR_MAX_ACTIVE || random() < SHOWER_NEAR_CHANCE)) ? "near" : "far";
    if (layer === "far" && farCount >= SHOWER_FAR_MAX_ACTIVE) return false;

    const diag = Math.hypot(width, height);
    const style = layer === "far"
      ? {
          kind: 0,
          len: diag * random(SHOWER_FAR_LENGTH_MIN, SHOWER_FAR_LENGTH_MAX),
          duration: random(SHOWER_FAR_DURATION_MIN, SHOWER_FAR_DURATION_MAX),
          scale: random(SHOWER_FAR_SCALE_MIN, SHOWER_FAR_SCALE_MAX),
          trailRatio: 0.45
        }
      : chooseMeteorStyle(true);

    const goldChance = now < meteorShower.goldBoostUntil
      ? SHOWER_GOLD_OPENING_CHANCE
      : SHOWER_GOLD_CHANCE;
    const gold = layer === "near" && meteorShower.manual && random() < goldChance;
    const fromLeft = meteorShower.fromLeft;
    const angleJitter = layer === "far" ? random(-11, 11) : random(-6, 6);
    const angle = meteorShower.angle + radians(angleJitter);
    const dirX = (fromLeft ? 1 : -1) * Math.cos(angle);
    const dirY = Math.sin(angle);
    const len = style.len;
    const spread = layer === "far" ? 0.82 : 0.62;
    const x0 = fromLeft ? random(-40, width * spread) : random(width * (1 - spread), width + 40);
    const y0 = random(-48, height * 0.18);
    const x1 = x0 + dirX * len;
    const y1 = y0 + dirY * len;

    const perpX = -dirY, perpY = dirX;
    const bow = (random() < 0.5 ? -1 : 1) * (layer === "far"
      ? random(4, 18)
      : random(2, 7 + style.kind * 3));
    const ctrlX = (x0 + x1) * 0.5 + perpX * bow;
    const ctrlY = (y0 + y1) * 0.5 + perpY * bow;
    if (!showerPathVisible(x0, y0, ctrlX, ctrlY, x1, y1, earthCx, earthCy, earthR)) continue;

    let curveLen = 0, lastX = x0, lastY = y0;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, u = 1 - t;
      const px = u * u * x0 + 2 * u * t * ctrlX + t * t * x1;
      const py = u * u * y0 + 2 * u * t * ctrlY + t * t * y1;
      curveLen += Math.hypot(px - lastX, py - lastY);
      lastX = px; lastY = py;
    }

    const sparks = [];
    const sparkCount = layer === "far" ? Math.floor(random(0, 2)) : Math.floor(random(0, 2 + style.kind * 2));
    for (let k = 0; k < sparkCount; k++) {
      sparks.push({
        t: random(0.12, 0.72),
        off: random(-5, 5),
        size: random(0.65, 1.05),
        boost: random(0.4, 0.9)
      });
    }

    showerMeteors.push({
      x0: x0, y0: y0, ctrlX: ctrlX, ctrlY: ctrlY, x1: x1, y1: y1,
      age: 0, duration: style.duration, afterglow: 0.28,
      len: len, curveLen: curveLen, sparks: sparks,
      trailLen: Math.min(style.kind === 2 ? 360 : style.kind === 1 ? 250 : 170,
        curveLen * style.trailRatio),
      scale: style.scale, gold: gold,
      layer: layer,
      trailPoints: layer === "far" ? SHOWER_FAR_TRAIL_POINTS : METEOR_TRAIL_POINTS,
      alphaScale: layer === "far" ? SHOWER_FAR_ALPHA_SCALE : 1,
      speedScale: layer === "far" ? random(SHOWER_FAR_SPEED_MIN, SHOWER_FAR_SPEED_MAX) : 1
    });
    return true;
  }
  return false;
}

function pathClear(x0, y0, cx, cy, x1, y1, earthCx, earthCy, earthR) {
  const samples = 24;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;

    // 不进入地球圆盘（留一点边缘余量），也不穿过左上角 HUD。
    if (Math.hypot(x - earthCx, y - earthCy) < earthR * 1.06) return false;
    if (x > 10 && x < 278 && y > 10 && y < 318) return false;
  }
  return true;
}

function spawnMeteor(cx, cy, earthR) {
  if (earthR > Math.min(width, height) * 0.55) return false;

  for (let attempt = 0; attempt < 42; attempt++) {
    const style = chooseMeteorStyle(false);
    const fromLeft = random() < 0.5;
    const angle = radians(random(25, 35));
    const dirX = (fromLeft ? 1 : -1) * Math.cos(angle);
    const dirY = Math.sin(angle);
    const len = style.len;
    const x0 = fromLeft ? random(-18, width * 0.28) : random(width * 0.72, width + 18);
    const y0 = random(-24, height * 0.14);
    const x1 = x0 + dirX * len;
    const y1 = y0 + dirY * len;

    const perpX = -dirY, perpY = dirX;
    const bow = (random() < 0.5 ? -1 : 1) * random(METEOR_BOW_MIN, METEOR_BOW_MAX + style.kind * 4);
    const ctrlX = (x0 + x1) * 0.5 + perpX * bow;
    const ctrlY = (y0 + y1) * 0.5 + perpY * bow;

    // 短流星继续完全避开地球；长/超长允许从地球后方穿过，利用现有遮挡形成真正的跨屏轨迹。
    const valid = style.kind === 0
      ? pathClear(x0, y0, ctrlX, ctrlY, x1, y1, cx, cy, earthR)
      : showerPathVisible(x0, y0, ctrlX, ctrlY, x1, y1, cx, cy, earthR);
    if (!valid) continue;

    let curveLen = 0, lastX = x0, lastY = y0;
    for (let k = 1; k <= 28; k++) {
      const t = k / 28, u = 1 - t;
      const px = u * u * x0 + 2 * u * t * ctrlX + t * t * x1;
      const py = u * u * y0 + 2 * u * t * ctrlY + t * t * y1;
      curveLen += Math.hypot(px - lastX, py - lastY);
      lastX = px; lastY = py;
    }

    const sparks = [];
    const sparkCount = Math.floor(random(2 + style.kind, 5 + style.kind * 2));
    for (let k = 0; k < sparkCount; k++) {
      sparks.push({
        t: random(0.14, 0.76),
        off: random(-6, 6),
        size: random(0.75, 1.25),
        boost: random(0.5, 1.0)
      });
    }

    meteors.push({
      x0: x0, y0: y0, ctrlX: ctrlX, ctrlY: ctrlY, x1: x1, y1: y1,
      age: 0, duration: style.duration, afterglow: METEOR_AFTERGLOW,
      len: len, curveLen: curveLen, sparks: sparks,
      trailLen: Math.min(style.kind === 2 ? 420 : style.kind === 1 ? 290 : 170,
        curveLen * style.trailRatio),
      scale: style.scale
    });
    return true;
  }
  return false;
}

/* 二次曲线上的位置与切线，返回复用对象，避免每帧产生大量临时对象。 */
const _meteorSample = { x: 0, y: 0, tx: 0, ty: 0 };
function sampleMeteor(m, t) {
  const u = 1 - t;
  _meteorSample.x = u * u * m.x0 + 2 * u * t * m.ctrlX + t * t * m.x1;
  _meteorSample.y = u * u * m.y0 + 2 * u * t * m.ctrlY + t * t * m.y1;
  _meteorSample.tx = 2 * (u * (m.ctrlX - m.x0) + t * (m.x1 - m.ctrlX));
  _meteorSample.ty = 2 * (u * (m.ctrlY - m.y0) + t * (m.y1 - m.ctrlY));
  return _meteorSample;
}

function drawStarDust(ctx) {
  if (reduceMotion) return;
  for (let i = 0; i < starDust.length; i++) {
    const d = starDust[i];
    ctx.fillStyle = "rgba(184,204,232," + d.a.toFixed(3) + ")";
    ctx.fillRect(d.x, d.y, 1, 1);
  }
}

function drawMeteorSet(ctx, list) {
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const scale = m.scale || 1;
    const gold = !!m.gold;
    const trailPoints = m.trailPoints || METEOR_TRAIL_POINTS;
    const speedScale = m.speedScale || 1;
    const liveDuration = m.duration / Math.max(0.1, speedScale);
    const travelAge = Math.min(m.age, liveDuration);
    const travelP = constrain(travelAge / liveDuration, 0, 1);
    const fadeIn = constrain(travelP / 0.18, 0, 1);
    const fadeOut = m.age <= liveDuration
      ? 1
      : 1 - constrain((m.age - liveDuration) / m.afterglow, 0, 1);
    const fade = fadeIn * fadeOut;
    const alpha = fade * (m.alphaScale || 1);

    const head = sampleMeteor(m, travelP);
    const headX = head.x, headY = head.y;
    const headSpeed = Math.hypot(head.tx, head.ty) || 1;
    const ux = head.tx / headSpeed, uy = head.ty / headSpeed;
    const pxDir = -uy, pyDir = ux;
    const trailLen = (m.trailLen || Math.min(170, m.curveLen * 0.62)) * scale;
    const tailSpanT = Math.min(0.68, trailLen / Math.max(1, m.curveLen));

    // 头部有一圈很淡的光晕；手动触发时改成黄铜暖光。
    const haloSize = (13 + 4 * fade) * scale;
    const halo = ctx.createRadialGradient(headX, headY, 0, headX, headY, haloSize);
    if (gold) {
      halo.addColorStop(0.00, "rgba(255,228,170," + (0.17 * alpha * scale).toFixed(3) + ")");
      halo.addColorStop(0.28, "rgba(227,160,76," + (0.08 * alpha * scale).toFixed(3) + ")");
      halo.addColorStop(1.00, "rgba(160,98,32,0)");
    } else {
      halo.addColorStop(0.00, "rgba(230,242,255," + (0.16 * alpha * scale).toFixed(3) + ")");
      halo.addColorStop(0.28, "rgba(176,211,247," + (0.07 * alpha * scale).toFixed(3) + ")");
      halo.addColorStop(1.00, "rgba(126,170,230,0)");
    }
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(headX, headY, haloSize, 0, TWO_PI); ctx.fill();

    // 外层余温 + 内层亮核，全部沿着曲线轨迹采样。
    for (let k = trailPoints - 1; k >= 0; k--) {
      const raw = k / (trailPoints - 1);
      const t = Math.pow(raw, 1.35);
      const sampleT = Math.max(0, travelP - tailSpanT * t);
      const q = sampleMeteor(m, sampleT);
      const px = q.x, py = q.y;

      const outerA = alpha * Math.pow(1 - t, 1.95) * 0.18 * scale;
      if (outerA > 0.004) {
        const outerS = (2.45 - 1.05 * t) * scale;
        const r = gold ? Math.round(134 + 93 * (1 - t)) : Math.round(92 + 62 * (1 - t));
        const g = gold ? Math.round(82 + 78 * (1 - t)) : Math.round(142 + 54 * (1 - t));
        const b = gold ? Math.round(34 + 42 * (1 - t)) : Math.round(210 + 35 * (1 - t));
        ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + outerA.toFixed(3) + ")";
        ctx.fillRect(px - outerS * 0.5, py - outerS * 0.5, outerS, outerS);
      }

      const coreA = alpha * Math.pow(1 - t, 2.2) * 0.40 * scale;
      if (coreA <= 0.005) continue;
      const coreS = (1.85 - 0.75 * t) * scale;
      const r = gold ? Math.round(208 + 47 * (1 - t)) : Math.round(158 + 78 * (1 - t));
      const g = gold ? Math.round(136 + 100 * (1 - t)) : Math.round(198 + 44 * (1 - t));
      const b = gold ? Math.round(58 + 132 * (1 - t)) : Math.round(235 + 20 * (1 - t));
      ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + coreA.toFixed(3) + ")";
      ctx.fillRect(px - coreS * 0.5, py - coreS * 0.5, coreS, coreS);
    }

    // 几颗偏离主轨迹的小火花，沿着曲线法线方向散开。
    for (let k = 0; k < m.sparks.length; k++) {
      const sp = m.sparks[k];
      const sampleT = Math.max(0, travelP - tailSpanT * sp.t);
      const q = sampleMeteor(m, sampleT);
      const localSpeed = Math.hypot(q.tx, q.ty) || 1;
      const nx = -q.ty / localSpeed, ny = q.tx / localSpeed;
      const px = q.x + nx * sp.off;
      const py = q.y + ny * sp.off;
      const a = alpha * Math.pow(1 - sp.t, 1.8) * 0.16 * sp.boost * scale;
      if (a <= 0.004) continue;
      ctx.fillStyle = gold
        ? "rgba(255,222,158," + a.toFixed(3) + ")"
        : "rgba(210,228,252," + a.toFixed(3) + ")";
      ctx.fillRect(px, py, sp.size * scale, sp.size * scale);
    }

    // 亮度最高的头部最后压上去，并留一个极小的白点。
    const hs = (2.5 - 0.4 * (1 - fade)) * scale;
    ctx.fillStyle = gold
      ? "rgba(255,239,202," + constrain(0.90 * alpha * scale, 0, 1).toFixed(3) + ")"
      : "rgba(238,247,255," + constrain(0.88 * alpha * scale, 0, 1).toFixed(3) + ")";
    ctx.fillRect(headX - hs * 0.5, headY - hs * 0.5, hs, hs);
    ctx.fillStyle = gold
      ? "rgba(255,248,224," + constrain(0.78 * alpha * scale, 0, 1).toFixed(3) + ")"
      : "rgba(255,255,255," + constrain(0.72 * alpha * scale, 0, 1).toFixed(3) + ")";
    ctx.fillRect(headX - 0.7 * scale, headY - 0.7 * scale, 1.4 * scale, 1.4 * scale);
  }
}

function drawMeteorShowerGlow(ctx) {
  if (reduceMotion || !meteorShower) return;
  const now = millis() / 1000;
  const intensity = showerIntensity(now);
  if (intensity <= 0.01) return;

  const left = meteorShower.fromLeft;
  const x = left ? width * 0.06 : width * 0.94;
  const y = height * 0.05;
  const radius = Math.min(width, height) * 0.35;
  const pulse = 0.82 + 0.18 * Math.sin(now * 0.32);
  const a = SHOWER_RADIANT_ALPHA * intensity * pulse;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0.00, "rgba(140,180,230," + a.toFixed(3) + ")");
  glow.addColorStop(0.32, "rgba(118,160,214," + (a * 0.45).toFixed(3) + ")");
  glow.addColorStop(1.00, "rgba(90,130,190,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TWO_PI); ctx.fill();
}

function drawMeteors(ctx) {
  if (reduceMotion) return;
  drawMeteorShowerGlow(ctx);
  drawMeteorSet(ctx, meteors);
  drawMeteorSet(ctx, showerMeteors);
}

function setupCamera() {
  capture = createCapture(VIDEO);
  videoEl = capture.elt || capture;
  if (videoEl && videoEl.style) videoEl.style.display = "none";
  if (videoEl && videoEl.play) {
    const pr = videoEl.play();
    if (pr && pr.catch) pr.catch(() => {});     // 忽略自动播放限制的报错
  }
}

function setupDetect() {
  detect = document.createElement("canvas");
  detect.width = Math.max(8, Math.floor(width / DETECT_SCALE));
  detect.height = Math.max(8, Math.floor(height / DETECT_SCALE));
  dctx = detect.getContext("2d", { willReadFrequently: true });
  prevData = null;
  lastCX = lastCY = null;
  motionVX = motionVY = 0;
  maskBuf = new Uint8Array(detect.width * detect.height);
}

// ---------------- 每秒 60 次 ----------------
function draw() {
  // 有些机器上 p5 会跑得比屏幕刷新率还快，这里自己卡一道，
  // 省电、也不会让风扇狂转（跳过也只是少画一帧，画布保留上一帧）
  const nowMs = millis();
  if (nowMs - lastDrawMs < 1000 / TARGET_FPS - 0.7) return;
  lastDrawMs = nowMs;

  // 自己数真实渲染帧率
  fpsCount++;
  if (nowMs - fpsT0 >= 500) {
    cameraFps = (fpsCount * 1000) / (nowMs - fpsT0);
    fpsCount = 0;
    fpsT0 = nowMs;
  }

  background(4, 6, 12);
  cameraOk = cameraReady();

  // 让转动/惯性/缩放的速度和帧率无关：
  // 不管跑 60 还是 120fps，手感和"一拍"的时间都一样
  const dtSec = constrain(deltaTime / 1000, 0.001, 0.1);
  dtScale = dtSec * 60;

  if (revealT < 1) revealT = Math.min(1, revealT + dtSec / 1.4);   // 开场：一次扫描

  // 1) 隔帧把手部画面喂给识别库
  feedHands();

  // 2) 控制来源
  //   识别库能用 → 一直用它（手离开画面马上进惯性，不再退回抖动的画面运动方式）
  //   识别库不能用 → 才退回「画面运动」方式
  usingHandsNow = handReady && handSeen && (frameCount - lastHandFrame) < 6;
  let inputVX = 0, inputVY = 0, hasInput = false, zoomInput = null;

  if (handReady) {
    // 转动已经在 onHandResults 里直接加到 rotY / rotX 上了（完全跟手）
    hasInput = usingHandsNow;
    if (usingHandsNow) zoomInput = handZoom;
  } else {
    const g = readGesture();
    if (g) {
      inputVX = g.vx;
      inputVY = g.vy;
      hasInput = g.n >= MIN_MOTION;
      if (g.n > 60) zoomInput = g.spread;
    }
  }

  if (hasInput) {
    silence = 0;
    if (!usingHandsNow) {
      const k = dtScale;
      rotY += constrain(inputVX * FOLLOW * followX * k, -MAX_STEP * k, MAX_STEP * k);
      rotX += constrain(inputVY * FOLLOW * HAND_FOLLOW_Y * invertY * k, -MAX_STEP * k, MAX_STEP * k);
      spinY = spinY * 0.5 + inputVX * FLICK * 0.5;
      spinX = spinX * 0.5 + inputVY * FLICK * 0.5;
    }
  } else {
    // 没有输入：靠惯性滑一会儿再停
    silence += dtScale;
    rotY += spinY * dtScale;
    rotX += spinX * dtScale;
    spinY *= pow(GLIDE, dtScale);
    spinX *= pow(GLIDE, dtScale);
    if (Math.abs(spinY) < 0.00008) spinY = 0;
    if (Math.abs(spinX) < 0.00008) spinX = 0;
  }

  // 3) 缩放
  if (zoomInput != null) {
    const want = map(constrain(zoomInput, SPREAD_LO, SPREAD_HI),
                     SPREAD_LO, SPREAD_HI, ZOOM_MIN, ZOOM_MAX * 0.85);
    zoomTarget = zoomTarget * 0.85 + want * 0.15;
  }

  // 4) 更新视角
  if (Math.abs(fiveZoomImpulse) > 0.0005) {
    const step = constrain(fiveZoomImpulse, -HAND_FIVE_IMPULSE_STEP, HAND_FIVE_IMPULSE_STEP);
    const oldZoomTarget = zoomTarget;
    zoomTarget = constrain(zoomTarget * (1 + step), ZOOM_MIN, ZOOM_MAX);
    if (zoomTarget === ZOOM_MIN || zoomTarget === ZOOM_MAX || zoomTarget === oldZoomTarget) {
      fiveZoomImpulse = 0;
    } else {
      fiveZoomImpulse -= step;
      if (Math.abs(fiveZoomImpulse) < 0.0005) fiveZoomImpulse = 0;
    }
  }

  const focusing = updateCityFocus(dtSec);
  updateObserverLabelBoosts(dtSec);
  if (autoSpin && !focusing && !dragging && !usingHandsNow && silence > 150 && spinY === 0) rotY += AUTO_SPIN * dtScale;
  rotX = constrain(rotX, -1.3, 1.3);

  // 3) 缩放平滑
  zoom += (zoomTarget - zoom) * (1 - pow(1 - 0.1, dtScale));
  updateMotionBoost(dtSec);

  // 4) 画
  gRot.R = Math.min(width, height) * GLOBE_RATIO;
  gRot.cx = width / 2;
  gRot.cy = height / 2;
  gRot.cr = Math.cos(rotX); gRot.sr = Math.sin(rotX);
  gRot.cyw = Math.cos(rotY); gRot.syw = Math.sin(rotY);
  _cityHitTargets.length = 0;
  const fieldRate = handFieldTargetStrength > handFieldStrength ? 0.30 : 0.08;
  const fieldK = 1 - Math.pow(1 - fieldRate, dtScale);
  handFieldX += (handFieldTargetX - handFieldX) * fieldK;
  handFieldY += (handFieldTargetY - handFieldY) * fieldK;
  handFieldStrength += (handFieldTargetStrength - handFieldStrength) * fieldK;

  updateBackground(dtSec, gRot.cx, gRot.cy, gRot.R * zoom);
  updateArrivalProgress(dtSec);
  drawGlobe();        // 背景星 / 太阳 / 大气 / 球体 / 经纬网 / 赤道环 / 海陆点阵 / 极光
  drawCityLights();   // 夜面城市灯光（贴地）
  drawFlights(ctx2d());  // 航线 + 航班（大气层）
  drawOrbits(ctx2d());   // 人造卫星（轨道层）
  drawMarkers();      // 城市/国家标注（永远在最上层）
  drawStatus();
  updateReadout();
  if (showDebug) drawDebug();
}

/* ---------- 3D → 2D 投影 ---------- */
// 注意：返回的是同一个对象（复用），调用后立刻用掉就行，不要存起来
const _q = { x: 0, y: 0, z: 0 };

function project(p, cr, sr, cyw, syw, R, cx, cy) {
  const x1 = p.x * cyw + p.z * syw;     // 绕 Y 轴（左右转）
  const z1 = -p.x * syw + p.z * cyw;
  const y2 = p.y * cr - z1 * sr;        // 绕 X 轴（上下转）
  const z2 = p.y * sr + z1 * cr;
  const depth = 1 + (1 - z2) * 0.3;     // 近大远小

  _q.x = cx + (x1 * R * zoom) / depth;
  _q.y = cy + (y2 * R * zoom) / depth;
  _q.z = z2;
  _q.rx = x1;         // 旋转后的法线（算受光用）
  _q.ry = y2;
  return _q;
}

function drawGlobe() {
  const R = gRot.R, cx = gRot.cx, cy = gRot.cy;
  const ctx = drawingContext;
  ctx.save();

  // ① 背景星：先铺极淡星尘，再画星点和少量慢闪，最后让流星从它们上方掠过
  drawStarDust(ctx);
  const bgT = millis() / 1000;
  for (let i = 0; i < bgStars.length; i++) {
    const st = bgStars[i];
    const tw = st.tw && !reduceMotion
      ? 1 + st.tw * Math.sin(bgT * TWO_PI / st.tp + st.ph)
      : 1;
    const a = constrain(st.a * tw, 0, 0.34);
    ctx.fillStyle = "rgba(198,216,240," + a.toFixed(3) + ")";
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
  drawMeteors(ctx);

  // ② 太阳：真正的光源，位置和光方向一致（所以在球的后面，被地球挡住的就该挡住）
  const sunPos = sunScreenPos(cx, cy);
  drawSun(ctx, sunPos.x, sunPos.y);

  // ③ 月亮：暗面的那一颗（在地球之前画，重叠处会被地球自然挡住）
  drawMoon(ctx);

  // ④ 大气：贴着球缘的一圈冷光
  const haze = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.24);
  haze.addColorStop(0, "rgba(92,142,200,0)");
  haze.addColorStop(0.5, "rgba(96,150,208,0.14)");
  haze.addColorStop(1, "rgba(90,140,200,0)");
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.24, 0, Math.PI * 2);
  ctx.fill();

  // ⑤ 球体：压成一块深色的球，让点阵浮在上面
  ctx.beginPath();
  ctx.arc(cx, cy, R * zoom, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  body.addColorStop(0, "rgba(22,36,60,0.95)");
  body.addColorStop(1, "rgba(8,13,24,0.98)");
  ctx.fillStyle = body;
  ctx.fill();

  // ⑥ 经纬网（仪器的刻度）：受光的一侧更清楚
  drawGraticule(ctx);

  // ⑦ 赤道环
  drawRing(ctx);

  // ⑧ 点阵：一次投影 → 按受光强度分档批量画
  buildBands(ptsSea, SEA_BAND_BUFS, SEA_BAND_N, N_SEA_BANDS, 1.2, 0.8);
  buildBands(ptsLand, LAND_BAND_BUFS, LAND_BAND_N, N_LAND_BANDS, LAND_DOT, LAND_DOT_Z);

  let sweepX = Infinity;
  if (revealT < 1) {
    const e = 1 - Math.pow(1 - revealT, 3);
    sweepX = cx - R * 1.3 + e * (R * 2.7);
  }

  drawBands(ctx, SEA_BAND_BUFS, SEA_BAND_N, SEA_BANDS, sweepX);
  drawBands(ctx, LAND_BAND_BUFS, LAND_BAND_N, LAND_BANDS, sweepX);

  // 近地粒子的前半段和已附着粒子：叠在陆地点之上、极光之下。
  drawArrivalBands(ctx);
  drawArrivalCompletionRing(ctx, R, cx, cy);

  // ⑨ 极光：夜面高纬度的青白光带（贴地，在陆地点之上、城市灯光之下）
  drawAurora(ctx);

  // ⑩ 入场扫描线（只在开场出现一次）
  if (revealT < 1) {
    ctx.fillStyle = "rgba(227,160,76," + (0.30 * (1 - revealT)).toFixed(3) + ")";
    ctx.fillRect(sweepX, cy - R * 1.25, 1, R * 2.5);
  }

  // ⑪ 受光那一侧的边缘高光：两层暖白弧光，颜色沿弧长从透明渐入再渐出
  const edgeR = Math.max(1, R * zoom - 0.5);
  const edgeStart = radians(178), edgeEnd = radians(286);
  const edgeGx0 = cx + Math.cos(edgeStart) * edgeR;
  const edgeGy0 = cy + Math.sin(edgeStart) * edgeR;
  const edgeGx1 = cx + Math.cos(edgeEnd) * edgeR;
  const edgeGy1 = cy + Math.sin(edgeEnd) * edgeR;

  const softEdge = ctx.createLinearGradient(edgeGx0, edgeGy0, edgeGx1, edgeGy1);
  softEdge.addColorStop(0.00, "rgba(255,238,214,0)");
  softEdge.addColorStop(0.20, "rgba(255,238,214,0.012)");
  softEdge.addColorStop(0.52, "rgba(255,238,214,0.042)");
  softEdge.addColorStop(0.82, "rgba(255,238,214,0.012)");
  softEdge.addColorStop(1.00, "rgba(255,238,214,0)");

  const coreEdge = ctx.createLinearGradient(edgeGx0, edgeGy0, edgeGx1, edgeGy1);
  coreEdge.addColorStop(0.00, "rgba(255,238,214,0)");
  coreEdge.addColorStop(0.20, "rgba(255,238,214,0.025)");
  coreEdge.addColorStop(0.52, "rgba(255,238,214,0.105)");
  coreEdge.addColorStop(0.82, "rgba(255,238,214,0.025)");
  coreEdge.addColorStop(1.00, "rgba(255,238,214,0)");

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = softEdge;
  ctx.lineWidth = 4.4;
  ctx.beginPath();
  ctx.arc(cx, cy, edgeR, edgeStart, edgeEnd);
  ctx.stroke();

  ctx.strokeStyle = coreEdge;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, edgeR - 0.2), edgeStart, edgeEnd);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  noStroke();
}

/* 人造卫星：轨道线 + 卫星本体 + 尾迹；被地球挡住的段落自动消失 */
function drawOrbits(ctx) {
  const cx = gRot.cx, cy = gRot.cy;
  const Rz = gRot.R * zoom;                    // 和地球一起缩放
  const Rsil = Rz * 0.99;                      // 地球的剪影半径（用来判遮挡）
  const t = millis() / 1000;
  const FRONT = "rgba(158,190,222,0.26)";
  const BACK = "rgba(150,182,214,0.12)";

  // ① 轨道线：每 2° 一个点，只有在地球前面（或剪影之外）才画
  for (let oi = 0; oi < orbitPts.length; oi++) {
    const list = orbitPts[oi];
    ctx.fillStyle = FRONT;
    for (let i = 0; i < list.length; i++) {
      const q = projectView(list[i], Rz, cx, cy);
      const inside = Math.hypot(q.x - cx, q.y - cy) < Rsil;
      if (q.z < 0 && inside) continue;          // 被地球挡住
      ctx.fillStyle = q.z >= 0 ? FRONT : BACK;
      ctx.fillRect(q.x, q.y, 1, 1);
    }
  }

  // ② 卫星：黄铜色本点 + 一段尾迹；进地球阴影会变暗
  for (let oi = 0; oi < ORBITS.length; oi++) {
    const o = ORBITS[oi];
    const th = o.phase + t * o.speed;

    // 尾迹：快速转动时按真实旋转速度拉长
    const tailPoints = 12 + Math.round(6 * motionBoost);
    for (let k = tailPoints; k >= 1; k--) {
      const pp = orbitPoint(o, th - k * 0.016);
      const qq = projectView(pp, Rz, cx, cy);
      const inside = Math.hypot(qq.x - cx, qq.y - cy) < Rsil;
      if (qq.z < 0 && inside) continue;
      const lit = satLight(pp);
      const a = 0.34 * (1 - k / (tailPoints + 1)) * lit * (1 + 0.45 * motionBoost);
      if (a <= 0.01) continue;
      ctx.fillStyle = "rgba(227,160,76," + a.toFixed(3) + ")";
      ctx.fillRect(qq.x, qq.y, 1.4, 1.4);
    }

    // 本体
    const p = orbitPoint(o, th);
    const q = projectView(p, Rz, cx, cy);
    const inside = Math.hypot(q.x - cx, q.y - cy) < Rsil;
    if (q.z < 0 && inside) continue;
    const lit = satLight(p);

    const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 8);
    g.addColorStop(0, "rgba(255,216,156," + (0.55 * lit).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,200,130,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "rgba(255,240,208," + (0.95 * lit).toFixed(3) + ")";
    ctx.fillRect(q.x - 1.2, q.y - 1.2, 2.4, 2.4);
  }

  drawStationOrbit(ctx, Rz, cx, cy, Rsil, t);
}

function cityPulseAmount(name, nowMs) {
  if (!name || name !== stationPulseCity || nowMs > stationPulseUntil) return 0;
  const p = constrain((nowMs - stationPulseStart) / STATION_PASS_PULSE_MS, 0, 1);
  return Math.sin(p * Math.PI);
}

function checkStationOverflight(x, y, z) {
  const nowMs = millis();
  if (nowMs - stationPulseLastGlobal < STATION_PASS_GLOBAL_MS) return;
  for (let i = 0; i < _cityHitTargets.length; i++) {
    const c = _cityHitTargets[i];
    if (nowMs - (stationPulseCooldown[c.name] || -Infinity) < STATION_PASS_CITY_MS) continue;
    if (Math.hypot(x - c.x, y - c.y) <= STATION_PASS_RADIUS) {
      stationPulseCity = c.name;
      stationPulseStart = nowMs;
      stationPulseUntil = nowMs + STATION_PASS_PULSE_MS;
      stationPulseLastGlobal = nowMs;
      stationPulseCooldown[c.name] = nowMs;
      return;
    }
  }
}

function drawStationOrbit(ctx, Rz, cx, cy, Rsil, t) {
  const o = STATION_ORBIT;
  const FRONT = "rgba(158,190,222,0.24)";
  const BACK = "rgba(150,182,214,0.10)";

  // 空间站轨道继续沿用卫星轨道的点阵语言。
  for (let i = 0; i < stationOrbitPts.length; i++) {
    const q = projectView(stationOrbitPts[i], Rz, cx, cy);
    const inside = Math.hypot(q.x - cx, q.y - cy) < Rsil;
    if (q.z < 0 && inside) continue;
    ctx.fillStyle = q.z >= 0 ? FRONT : BACK;
    ctx.fillRect(q.x, q.y, 1, 1);
  }

  const th = o.phase + t * o.speed;
  const p = orbitPoint(o, th);
  const q = projectView(p, Rz, cx, cy);
  const headX = q.x, headY = q.y, headZ = q.z;
  if (headZ < 0 && Math.hypot(headX - cx, headY - cy) < Rsil) return;
  checkStationOverflight(headX, headY, headZ);

  // 用轨道切线决定空间站朝向，太阳翼始终垂直飞行方向。
  const next = orbitPoint(o, th + 0.018);
  const q2 = projectView(next, Rz, cx, cy);
  const angle = Math.atan2(q2.y - headY, q2.x - headX);
  const lit = satLight(p);
  const stationScale = constrain(0.86 + (zoom - 1) * 0.22, 0.86, 1.36);

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(angle);
  ctx.scale(stationScale, stationScale);

  // 两片长太阳翼：冷蓝灰面板 + 一条很短的受光高光。
  const highGlint = 1 + 0.25 * motionBoost;
  const panelA = 0.18 + 0.48 * lit;
  ctx.fillStyle = "rgba(116,156,194," + panelA.toFixed(3) + ")";
  ctx.fillRect(-4.8, -8.1, 9.6, 2.3);
  ctx.fillRect(-4.8, 5.8, 9.6, 2.3);

  ctx.fillStyle = "rgba(202,222,239," + constrain(0.12 + 0.42 * lit * highGlint, 0, 1).toFixed(3) + ")";
  ctx.fillRect(-4.5, -7.8, 8.9, 0.45);
  ctx.fillRect(-4.5, 6.1, 8.9, 0.45);

  // 横向桁架与中央舱体。
  ctx.fillStyle = "rgba(227,160,76," + (0.28 + 0.52 * lit).toFixed(3) + ")";
  ctx.fillRect(-0.65, -5.6, 1.3, 11.2);

  ctx.fillStyle = "rgba(233,229,218," + (0.52 + 0.42 * lit).toFixed(3) + ")";
  ctx.fillRect(-1.6, -1.1, 3.2, 2.2);

  ctx.fillStyle = "rgba(255,240,208," + (0.62 + 0.35 * lit).toFixed(3) + ")";
  ctx.fillRect(-0.9, -0.55, 1.8, 1.1);

  ctx.restore();
}

/* 卫星被太阳照到多少（跑到地球阴影里就变暗） */
function satLight(p) {
  // 太阳在有限远 → 晨昏线整体往受光面推，卫星的阴影边界也跟着推
  const lam = p.x * L.x + p.y * L.y + p.z * L.z;
  return constrain((lam + 0.10) / 0.60, 0.06, 1);
}

/* ==========================================================
   航班网络：真实主干航线（点状大圆弧）+ 飞行中的航班
   ========================================================== */
function buildCities() {
  CITIES = {};
  LABELED_CITY_NAMES = {};
  for (let i = 0; i < places.length; i++) {
    if (places[i].type === "city") {
      CITIES[places[i].name] = places[i];
      LABELED_CITY_NAMES[places[i].name] = true;
    }
  }
  for (let i = 0; i < LIGHTS.length; i++) {
    if (LIGHTS[i].name) CITIES[LIGHTS[i].name] = LIGHTS[i];
  }
  for (let i = 0; i < ROUTES.length; i++) {
    if (!CITIES[ROUTES[i][0]] || !CITIES[ROUTES[i][1]]) {
      console.warn("航线端点找不到城市:", ROUTES[i][0], ROUTES[i][1]);
    }
  }
}

/* 球面线性插值：两点之间的大圆弧（真实航线走的就是这个） */
function slerpUnit(a, b, t, ang, radius) {
  const sn = Math.sin(ang);
  let k1, k2;
  if (sn < 1e-6) { k1 = 1 - t; k2 = t; }
  else { k1 = Math.sin((1 - t) * ang) / sn; k2 = Math.sin(t * ang) / sn; }
  let x = a.x * k1 + b.x * k2;
  let y = a.y * k1 + b.y * k2;
  let z = a.z * k1 + b.z * k2;
  const n = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / n * radius, y: y / n * radius, z: z / n * radius };
}

function buildRoutes() {
  routePaths = [];
  for (let i = 0; i < ROUTES.length; i++) {
    const ca = CITIES[ROUTES[i][0]], cb = CITIES[ROUTES[i][1]];
    if (!ca || !cb) continue;
    const va = toXYZ(ca.lat, ca.lon);
    const vb = toXYZ(cb.lat, cb.lon);
    const dot = constrain(va.x * vb.x + va.y * vb.y + va.z * vb.z, -1, 1);
    const ang = Math.acos(dot);
    const steps = Math.max(8, Math.round((ang * 180 / Math.PI) / 3));   // 每 3° 一个采样点
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      pts.push(slerpUnit(va, vb, k / steps, ang, 1.02));                // 抬到 1.02 半径
    }
    routePaths.push({
      pts: pts, va: va, vb: vb, ang: ang,
      aName: ca.name, bName: cb.name,
      planes: (ca.name === "香港" || cb.name === "香港" ||
               ca.name === "新加坡" || cb.name === "新加坡")
        ? 2 + (i % 2)                            // 香港/新加坡航线：2~3 架
        : 1 + (i % 3 === 0 ? 1 : 0),             // 其他航线：1~2 架
      speed: 1 / (25 + (i * 7) % 36),            // 跑完全程 25~60 秒
      phase: (i * 0.37) % 1
    });
  }
}

/* 航线 + 航班：只在放大后出现（≤1.35× 整层跳过），或用 f 强制显示 */
function drawFlights(ctx) {
  const vis = forceFlights ? 1 : constrain((zoom - 1.35) / 0.45, 0, 1);
  flightCount = 0;
  if (vis <= 0.01) return;

  const cx = gRot.cx, cy = gRot.cy;
  const Rz = gRot.R * zoom;
  const Rsil = Rz * 0.99;
  const t = millis() / 1000;

  for (let i = 0; i < routePaths.length; i++) {
    const rt = routePaths[i];
    const pts = rt.pts;
    const focusName = cityFocus && cityFocus.mode === "focus" ? cityFocus.name : "";
    const routeFocused = focusName && (rt.aName === focusName || rt.bName === focusName);
    const routeFlash = routeFocused ? routeFlashAmount(focusName, millis()) : 0;
    const routeDotSize = routeFocused
      ? 1.2 + (zoom - 1.35) * 0.8 + 0.18 * routeFlash
      : 1.2 + (zoom - 1.35) * 0.8;

    // 先粗判：这条航线有没有任何一段可能出现在画面里（不在就整条跳过，省性能）
    let maybeVisible = false;
    const probeStep = Math.max(1, Math.floor(pts.length / 10));
    for (let s2 = 0; s2 < pts.length; s2 += probeStep) {
      const qq = project(pts[s2], gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, cx, cy);
      const inFront = !(qq.z < 0 && Math.hypot(qq.x - cx, qq.y - cy) < Rsil);
      if (inFront && qq.x > -80 && qq.x < width + 80 && qq.y > -80 && qq.y < height + 80) {
        maybeVisible = true;
        break;
      }
    }
    if (!maybeVisible) continue;

    // ① 航线：逐段画，放大时按屏幕距离补点 → 点距恒定，看起来是一条虚线
    const dense = zoom > 1.8;
    const dotSize = constrain(1.2 + (zoom - 1.35) * 0.8, 1.2, 2.8);
    const boost = constrain(1 + (zoom - 1.35) * 0.35, 1, 1.45);
    const step = dense ? 1 : 2;
    let prevQ = null;
    let lastLvl = -1;

    for (let k = 0; k < pts.length; k += step) {
      const q = project(pts[k], gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, cx, cy);
      const visible = !(q.z < 0 && Math.hypot(q.x - cx, q.y - cy) < Rsil) &&
                      q.x > -30 && q.x < width + 30 && q.y > -30 && q.y < height + 30;
      if (!visible) { prevQ = null; continue; }

      const lam = lamAt(q);
      const lvl = lam > 0.30 ? 2 : (lam > -0.20 ? 1 : 0);

      if (prevQ) {
        const dist = Math.hypot(q.x - prevQ.x, q.y - prevQ.y);
        const per = dense ? constrain(Math.round(dist / 4), 1, 16) : 1;
        if (lvl !== lastLvl) {
          const ink = ROUTE_STYLE[lvl];
          const a = constrain(vis * boost * ink.a * (routeFocused ? CITY_ROUTE_BOOST * (1 + CITY_ROUTE_FLASH_GAIN * routeFlash) : 1), 0, 1);
          const mix = routeFocused ? routeFlash * 0.84 : 0;
          const r = Math.round(ink.r + (ROUTE_FLASH_RGB.r - ink.r) * mix);
          const g = Math.round(ink.g + (ROUTE_FLASH_RGB.g - ink.g) * mix);
          const b = Math.round(ink.b + (ROUTE_FLASH_RGB.b - ink.b) * mix);
          ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
          lastLvl = lvl;
        }
        for (let j = 1; j <= per; j++) {
          const tt = j / per;
          ctx.fillRect(prevQ.x + (q.x - prevQ.x) * tt, prevQ.y + (q.y - prevQ.y) * tt, routeDotSize, routeDotSize);
        }
      }
      prevQ = { x: q.x, y: q.y };
    }

    // ② 航班：黄铜色小点 + 3 段渐隐尾迹
    for (let n = 0; n < rt.planes; n++) {
      const tp = (rt.phase + n * 0.5 + t * rt.speed) % 1;
      const p = slerpUnit(rt.va, rt.vb, tp, rt.ang, 1.03);
      const q = project(p, gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, cx, cy);
      if (q.z < 0 && Math.hypot(q.x - cx, q.y - cy) < Rsil) continue;
      // 受光量要用「转过之后」的位置算（和航线、卫星一致）。
      // 之前用的是未旋转的经纬度 → 变成按地区固定明暗：中国上空永远 0.06、欧洲永远 1.0
      // 夜面的航班给一个亮度下限（0.25），否则飞进夜面就彻底看不见了
      const lit = constrain(satLight({ x: q.rx, y: q.ry, z: q.z }), 0.25, 1);
      const a0 = constrain(vis * lit * (routeFocused ? 1.18 * (1 + 0.32 * routeFlash) : 1), 0, 1);

      // 航班尾迹：只保留飞机后方的一段渐隐轨迹，不再改变底下航线颜色。
      const tailPoints = 9 + Math.round(6 * motionBoost);
      for (let k = tailPoints; k >= 1; k--) {
        const tq = tp - k * 0.0095;
        if (tq < 0) continue;
        const pp = slerpUnit(rt.va, rt.vb, tq, rt.ang, 1.03);
        const qq = project(pp, gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, cx, cy);
        if (qq.z < 0 && Math.hypot(qq.x - cx, qq.y - cy) < Rsil) continue;
        // 尾迹各点也按自己的位置算，并且同样有亮度下限
        const litT = constrain(satLight({ x: qq.rx, y: qq.ry, z: qq.z }), 0.25, 1);
        const a = constrain(vis * litT * 0.62 * (1 - k / (tailPoints + 1)) * (1 + 0.40 * motionBoost) * (1 + 0.25 * routeFlash), 0, 1);
        const ts = constrain(1.4 + (zoom - 1.35) * 0.45, 1.4, 2.8);
        // 受光面用更深的琥珀（压在白陆地上），夜面用亮琥珀
        const trail = litT > 0.55 ? "150,96,40" : "227,160,76";
        ctx.fillStyle = "rgba(" + trail + "," + a.toFixed(3) + ")";
        ctx.fillRect(qq.x, qq.y, ts, ts);
      }

      // 本体：先画一圈深色描边，再画暖白核心
      //（这样压在象牙白的陆地上、或者黑暗的海洋上都看得见）
      const ps = constrain(1.5 + (zoom - 1.35) * 0.5, 1.5, 3.2);
      ctx.fillStyle = "rgba(6,10,20," + (a0 * 0.60).toFixed(3) + ")";
      ctx.fillRect(q.x - ps * 0.5 - 1, q.y - ps * 0.5 - 1, ps + 2, ps + 2);
      ctx.fillStyle = "rgba(255,238,205," + (a0 * 0.95).toFixed(3) + ")";
      ctx.fillRect(q.x - ps * 0.5, q.y - ps * 0.5, ps, ps);
      flightCount++;
    }
  }
}

/* ==========================================================
   极光：夜面高纬度的青白色弧带（缓慢起伏，不闪）
   ========================================================== */
function buildAurora() {
  auroraN = []; auroraS = [];
  for (let lon = -180; lon < 180; lon += 2) {
    const wob = Math.sin(radians(lon * 2.0)) * 3.2 + Math.sin(radians(lon * 3.7 + 40)) * 1.6;
    // 往磁极方向偏一点，做出不规则的极光椭圆
    auroraN.push(toXYZ(66 + wob + 7 * Math.cos(radians(lon - 100)), lon));
    auroraS.push(toXYZ(-(66 + wob * 0.8) - 7 * Math.cos(radians(lon - 135)), lon));
  }
}

function drawAurora(ctx) {
  const bands = [auroraN, auroraS];
  const t = millis() / 1000;

  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    let lastA = -1;
    for (let i = 0; i < band.length; i++) {
      const p = band[i];
      const drift = Math.sin(t * 0.05 + p.z * 2.0) * 1.1;         // 极缓慢的纬度漂移
      const wob = { x: p.x, y: p.y + drift * 0.02, z: p.z };
      const q = project(wob, gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, gRot.cx, gRot.cy);
      if (q.z < 0.04) continue;

      const lam = lamAt(q);
      const night = constrain((0.25 - lam) / 0.55, 0, 1);          // 只在夜面（含一点暮光）
      if (night <= 0.03) continue;

      const pulse = 0.6 + 0.4 * Math.sin(t * 0.18 + p.z * 3.0);    // 20~40 秒的缓慢起伏
      const a = night * pulse * 0.34;
      if (Math.abs(a - lastA) > 0.012) {
        ctx.fillStyle = "rgba(150,220,205," + a.toFixed(3) + ")";
        lastA = a;
      }
      // 竖直叠 3 个点，形成一条很窄的光带
      ctx.fillRect(q.x, q.y - 1.8, 1.4, 1.4);
      ctx.fillRect(q.x, q.y, 1.4, 1.4);
      ctx.fillRect(q.x, q.y + 1.8, 1.4, 1.4);
    }
  }
}

/* 太阳在屏幕上的位置：和光方向一致（同一个方向 ⇒ 晨昏线一定对着太阳） */
function sunScreenPos(cx, cy) {
  const R = Math.min(width, height) * GLOBE_RATIO * zoom;
  const q = projectView(SUN_POS, R, cx, cy);
  return {
    x: constrain(q.x, 46, width - 46),
    y: constrain(q.y, 46, height - 46)
  };
}

/* 太阳：核心 + 很克制的一圈日冕（暖白 → 琥珀） */
function drawSun(ctx, x, y) {
  const core = Math.max(5, Math.min(width, height) * 0.011);

  // 大范围的一点暖光，让整个视场知道光从哪来
  const wash = ctx.createRadialGradient(x, y, 0, x, y, core * 26);
  wash.addColorStop(0, "rgba(255, 228, 178, 0.10)");
  wash.addColorStop(0.35, "rgba(240, 186, 116, 0.04)");
  wash.addColorStop(1, "rgba(230, 170, 100, 0)");
  ctx.fillStyle = wash;
  ctx.beginPath(); ctx.arc(x, y, core * 26, 0, Math.PI * 2); ctx.fill();

  // 日冕
  const halo = ctx.createRadialGradient(x, y, core * 0.8, x, y, core * 9);
  halo.addColorStop(0, "rgba(255, 236, 198, 0.55)");
  halo.addColorStop(0.18, "rgba(246, 200, 132, 0.16)");
  halo.addColorStop(0.55, "rgba(232, 170, 96, 0.05)");
  halo.addColorStop(1, "rgba(232, 170, 96, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, core * 9, 0, Math.PI * 2); ctx.fill();

  // 日面
  const disc = ctx.createRadialGradient(x - core * 0.2, y - core * 0.2, 0, x, y, core);
  disc.addColorStop(0, "rgba(255, 254, 250, 1)");
  disc.addColorStop(0.62, "rgba(255, 242, 216, 0.98)");
  disc.addColorStop(1, "rgba(255, 216, 156, 0.42)");
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(x, y, core, 0, Math.PI * 2); ctx.fill();
}

/* 经纬网：每点单独按受光调透明度（点少，负担得起） */
function drawGraticule(ctx) {
  for (let i = 0; i < ptsGrid.length; i++) {
    const q = project(ptsGrid[i], gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, gRot.cx, gRot.cy);
    if (q.z < 0.02) continue;
    const lam = lamAt(q);
    const a = 0.035 + Math.max(0, lam) * 0.075;
    ctx.fillStyle = "rgba(150,182,214," + a.toFixed(3) + ")";
    ctx.fillRect(q.x, q.y, 1, 1);
  }
}

/* 赤道环：黄铜色，受光的一侧亮一些 */
function drawRing(ctx) {
  for (let i = 0; i < ptsRing.length; i++) {
    const q = project(ptsRing[i], gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, gRot.cx, gRot.cy);
    if (q.z < -0.35) continue;                       // 环的后半段不画
    const lam = lamAt(q);
    const a = 0.10 + Math.max(0, lam) * 0.30;
    ctx.fillStyle = "rgba(227,160,76," + a.toFixed(3) + ")";
    ctx.fillRect(q.x, q.y, 1.3, 1.3);
  }
}

/* 一次投影，把点按受光强度分到几个档里（每档只设一次颜色，快） */
function buildBands(list, bufs, counts, bandCount, sizeBase, sizeZ) {
  const need = list.length * 3;
  for (let b = 0; b < bandCount; b++) {
    if (!bufs[b] || bufs[b].length < need) bufs[b] = new Float32Array(need);
    counts[b] = 0;
  }

  for (let i = 0; i < list.length; i++) {
    const pt = list[i];
    const q = project(pt, gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, gRot.cx, gRot.cy);
    if (q.z < 0) continue;                           // 只画朝向屏幕的一面

    // 受光强度：-1（背光）→ 1（正对光源）
    const lam = lamAt(q);
    let b = Math.floor((lam * 0.5 + 0.5) * bandCount);
    if (b < 0) b = 0;
    if (b >= bandCount) b = bandCount - 1;

    // 屏幕外的点直接丢掉：放大到 3 倍时，九成以上的点都在画面外
    if (q.x < -24 || q.x > width + 24 || q.y < -24 || q.y > height + 24) continue;

    const s = (sizeBase + q.z * sizeZ) * (pt.s || 1);
    const buf = bufs[b];
    const k = counts[b];
    buf[k] = q.x; buf[k + 1] = q.y; buf[k + 2] = s;
    counts[b] = k + 3;
  }
}

/* 把各档的点一次画完（只设置几次颜色） */
function drawBands(ctx, bufs, counts, styles, maxX) {
  for (let b = 0; b < styles.length; b++) {
    const buf = bufs[b], n = counts[b];
    if (!buf || !n) continue;
    ctx.fillStyle = styles[b];
    for (let i = 0; i < n; i += 3) {
      if (buf[i] > maxX) continue;
      const s = buf[i + 2];
      ctx.fillRect(buf[i] - s * 0.5, buf[i + 1] - s * 0.5, s, s);
    }
  }
}

function smoothStep01(t) {
  t = constrain(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function updateArrivalProgress(dtSec) {
  let target = 0;
  if (zoom >= ARRIVAL_ZOOM_FULL) {
    target = 1;
  } else if (zoom > ARRIVAL_ZOOM_ACCEL) {
    target = 0.25 + 0.75 * smoothStep01((zoom - ARRIVAL_ZOOM_ACCEL) / (ARRIVAL_ZOOM_FULL - ARRIVAL_ZOOM_ACCEL));
  } else if (zoom > ARRIVAL_ZOOM_START) {
    target = 0.25 * smoothStep01((zoom - ARRIVAL_ZOOM_START) / (ARRIVAL_ZOOM_ACCEL - ARRIVAL_ZOOM_START));
  }

  if (reduceMotion) {
    arrivalProgress = target;
    arrivalRingT = -1;
  } else {
    const rate = target > arrivalProgress ? 0.16 : 0.045;
    arrivalProgress += (target - arrivalProgress) * (1 - Math.pow(1 - rate, dtScale));
  }

  if (!reduceMotion && arrivalProgress > 0.95 && zoom > 1.8 && !arrivalCompleteLatch) {
    arrivalCompleteLatch = true;
    arrivalRingT = 0;
  }
  if (arrivalProgress < 0.80) arrivalCompleteLatch = false;
  if (arrivalRingT >= 0) {
    arrivalRingT += dtSec / 0.85;
    if (arrivalRingT > 1) arrivalRingT = -1;
  }
}

const _arrivalP = { x: 0, y: 0, z: 0 };
function buildArrivalBands() {
  for (let b = 0; b < N_ARRIVAL_STYLES; b++) {
    if (!ARRIVAL_BAND_BUFS[b] || ARRIVAL_BAND_BUFS[b].length < arrivalParticles.length * 3) {
      ARRIVAL_BAND_BUFS[b] = new Float32Array(arrivalParticles.length * 3);
    }
    ARRIVAL_BAND_N[b] = 0;
  }
  if (!arrivalParticles.length) return;

  const t = millis() / 1000;
  const earthR = gRot.R * zoom;
  for (let i = 0; i < arrivalParticles.length; i++) {
    const p = arrivalParticles[i];
    const denom = Math.max(0.001, 1 - p.delay);
    const rawAttach = constrain((arrivalProgress - p.delay) / denom, 0, 1);
    const attach = smoothStep01(rawAttach);

    // 目标点是地球固定坐标，所以附着后仍随地球旋转。
    _arrivalP.x = p.tx; _arrivalP.y = p.ty; _arrivalP.z = p.tz;
    const targetQ = project(_arrivalP, gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, gRot.cx, gRot.cy);
    const targetX = targetQ.x, targetY = targetQ.y, targetZ = targetQ.z;
    const targetLam = lamAt(targetQ);

    // 背面目标在接近地球时自然消失，避免附着滤镜穿透地球。
    if (targetZ < 0 && attach > 0.55) continue;

    const drift = reduceMotion ? 0 : Math.sin(t * p.driftSpeed + p.phase);
    let floatX = (p.fx + p.dx * drift) * width;
    let floatY = (p.fy + p.dy * drift) * height;

    // 手掌经过时推开尚未附着的粒子；离开后排斥强度自然衰减。
    if (handFieldStrength > 0.01 && attach < 0.72) {
      const minSide = Math.min(width, height);
      const fieldR = minSide * HAND_FIELD_RADIUS_RATIO;
      const fdx = floatX - handFieldX, fdy = floatY - handFieldY;
      const fd = Math.hypot(fdx, fdy);
      if (fd > 0.001 && fd < fieldR) {
        const force = Math.pow(1 - fd / fieldR, 2) *
          minSide * HAND_FIELD_PUSH_RATIO * handFieldStrength * Math.pow(1 - attach, 1.5);
        floatX += (fdx / fd) * force;
        floatY += (fdy / fd) * force;
      }
    }

    const x = floatX + (targetX - floatX) * attach;
    const y = floatY + (targetY - floatY) * attach;
    if (x < -24 || x > width + 24 || y < -24 || y > height + 24) continue;

    // 低倍率时把地球核心区让出来，保证城市灯光和名称清晰可读。
    const coreDist = Math.hypot(x - gRot.cx, y - gRot.cy) / Math.max(1, earthR);
    if (attach < ARRIVAL_CORE_REVEAL && coreDist < ARRIVAL_CORE_RADIUS) continue;

    // 观察者模式优先展示航线和城市：核心区只保留约 1/4 粒子并缩小，外围同步减弱。
    let observerScale = 1;
    if (cityModeActive) {
      if (coreDist < 1.45) {
        if (i % 4 !== 0) continue;
        observerScale = 0.66;
      } else {
        observerScale = 0.84;
      }
    }

    const lightBand = targetLam > 0.34 ? 2 : (targetLam > -0.08 ? 1 : 0);
    const stage = Math.min(3, Math.floor(attach * 4));
    const styleIndex = stage * 3 + lightBand;
    const centerFade = 1 - 0.35 * Math.exp(-((x - gRot.cx) * (x - gRot.cx) + (y - gRot.cy) * (y - gRot.cy)) / Math.max(1, earthR * earthR));
    const size = (1.25 + 0.95 * attach) * p.s * centerFade * observerScale;
    const buf = ARRIVAL_BAND_BUFS[styleIndex];
    const k = ARRIVAL_BAND_N[styleIndex];
    buf[k] = x; buf[k + 1] = y; buf[k + 2] = size;
    ARRIVAL_BAND_N[styleIndex] = k + 3;
  }
}

function drawArrivalBands(ctx) {
  if (!arrivalParticles.length) return;
  buildArrivalBands();
  drawBands(ctx, ARRIVAL_BAND_BUFS, ARRIVAL_BAND_N, ARRIVAL_STYLES);
}

function drawArrivalCompletionRing(ctx, R, cx, cy) {
  if (arrivalRingT < 0) return;
  const t = constrain(arrivalRingT, 0, 1);
  const a = (1 - t) * (cityModeActive ? 0.045 : 0.13);
  const radius = R * zoom * (1.02 + 0.06 * smoothStep01(t));
  ctx.strokeStyle = "rgba(180,208,236," + a.toFixed(3) + ")";
  ctx.lineWidth = 0.8 + 0.7 * (1 - t);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.stroke();
}


/* 夜面城市灯光：像从太空看地球的夜景，暖色小光点 + 光晕 */
function drawCityLights() {
  if (!glowSprite) return;
  const R = gRot.R, cx = gRot.cx, cy = gRot.cy;
  const ctx = drawingContext;
  const t = millis() / 1000;
  ctx.save();

  // 先把所有灯光算出来（标注城市也在内），统一画
  for (let pass = 0; pass < 2; pass++) {
    const list = pass === 0 ? LIGHTS : places;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (pass === 1 && m.type !== "city") continue;      // 国家不画灯光
      if (pass === 1 && m.lights === false) continue;

      const q = project(toXYZ(m.lat, m.lon), gRot.cr, gRot.sr, gRot.cyw, gRot.syw, R, cx, cy);
      if (q.z < 0.06) continue;

      const lam = lamAt(q);
      // 只有跑到夜面才亮起来，跨过晨昏线时渐渐出现
      const night = constrain((0.30 - lam) / 0.55, 0, 1) * constrain(q.z * 2.2, 0, 1);
      if (night <= 0.02) continue;
      addCityHitTarget(m.name, q.x, q.y, null);

      // 每座城市相位不同：整体只是很轻微地一起一伏，不会造成闪烁感
      const weight = CITY_LIGHT_SCALE[m.name] || 1;
      const phase = m.lat * 0.113 + m.lon * 0.071;
      const breath = reduceMotion ? 1 : 1 + CITY_BREATH_DEPTH * (0.65 + 0.35 * weight) *
        Math.sin(t * TWO_PI / CITY_BREATH_PERIOD + phase);
      const sizeBreath = 1 + (breath - 1) * 0.55;
      const glowSize = (40 + night * 18) * weight * sizeBreath;
      const coreSize = 3.2 * weight * sizeBreath;
      const passPulse = cityPulseAmount(m.name, millis());
      const selectPulse = cityFocus && cityFocus.name === m.name ? routeFlashAmount(m.name, millis()) : 0;
      const brightness = (0.78 + 0.22 * weight) * breath * (1 + 0.35 * passPulse + 0.55 * selectPulse);
      const alpha = constrain(night * brightness, 0, 1);
      const pulseGlow = glowSize * (1 + 0.35 * passPulse + 0.45 * selectPulse);
      const pulseCore = coreSize * (1 + 0.20 * passPulse + 0.35 * selectPulse);

      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprite, q.x - pulseGlow / 2, q.y - pulseGlow / 2, pulseGlow, pulseGlow);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 240, 208, 1)";
      ctx.fillRect(q.x - pulseCore / 2, q.y - pulseCore / 2, pulseCore, pulseCore);
    }
  }
  ctx.restore();
}

function cityFocusAmount(x, y, cx, cy) {
  const zoomFocus = constrain(
    (zoom - CITY_FOCUS_ZOOM_START) / (CITY_FOCUS_ZOOM_FULL - CITY_FOCUS_ZOOM_START),
    0, 1
  );
  if (zoomFocus <= 0) return 0;
  const radius = Math.min(width, height) * CITY_FOCUS_RADIUS;
  const d = Math.hypot(x - cx, y - cy) / Math.max(1, radius);
  const t = constrain((d - 0.45) / 0.55, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return zoomFocus * (1 - smooth);
}

function addMarkerLabelRect(textX, y, size, width, alignLeft) {
  const x1 = alignLeft ? textX : textX - width;
  const rect = {
    x1: x1 - 3, x2: x1 + width + 3,
    y1: y - size * 0.75, y2: y + size * 0.75
  };
  _markerLabelRects.push(rect);
  return rect;
}

function markerRectOverlaps(rect) {
  for (let i = 0; i < _markerLabelRects.length; i++) {
    const r = _markerLabelRects[i];
    if (rect.x1 < r.x2 && rect.x2 > r.x1 && rect.y1 < r.y2 && rect.y2 > r.y1) return true;
  }
  return false;
}

function drawExtraCityLabels(ctx, cx, cy) {
  if (zoom < EXTRA_CITY_LABEL_ZOOM_START) return;

  const candidates = [];
  for (let i = 0; i < LIGHTS.length; i++) {
    const m = LIGHTS[i];
    if (!m.name || LABELED_CITY_NAMES[m.name]) continue;

    const q = project(toXYZ(m.lat, m.lon), gRot.cr, gRot.sr, gRot.cyw, gRot.syw, gRot.R, cx, cy);
    if (q.z < 0.12 || q.x < -24 || q.x > width + 24 || q.y < -24 || q.y > height + 24) continue;

    const weight = CITY_LIGHT_SCALE[m.name] || 1;
    const startZoom = EXTRA_CITY_LABEL_ZOOM_START + (1 - weight) * 0.65;
    const reveal = constrain((zoom - startZoom) / (EXTRA_CITY_LABEL_ZOOM_FULL - startZoom), 0, 1);
    if (reveal <= 0.02) continue;

    const lam = lamAt(q);
    const night = constrain((0.02 - lam) / 0.40, 0, 1);
    const day = 1 - night;
    const focus = cityFocusAmount(q.x, q.y, cx, cy);
    const passPulse = cityPulseAmount(m.name, millis());
    const selectPulse = cityFocus && cityFocus.name === m.name ? routeFlashAmount(m.name, millis()) : 0;
    const edgeFade = constrain((q.z - 0.10) / 0.18, 0, 1);
    const alpha = constrain(((day * 170 + night * 185) * reveal * edgeFade) + 62 * focus + 34 * passPulse + 46 * selectPulse, 0, 255);
    if (alpha < 18) continue;

    const dx = q.x - cx, dy = q.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const offset = 11;
    const lx = q.x + (dx / dist) * offset;
    const ly = q.y + (dy / dist) * offset;
    const observerGrow = observerLabelBoosts[m.name] || 0;
    const size = 9.5 + 1.2 * reveal + CITY_FOCUS_MAX_SIZE * focus * 0.75 + 0.8 * passPulse + 1.2 * selectPulse + OBSERVER_LABEL_GROW_PX * observerGrow;
    const textX = dx >= 0 ? lx + 3 : lx - 3;
    const alignLeft = dx >= 0;

    candidates.push({
      m: m, x: q.x, y: q.y, alpha: alpha, size: size, textX: textX, ly: ly,
      alignLeft: alignLeft, night: night > day,
      score: weight + focus * 0.8 + q.z * 0.35
    });
  }

  candidates.sort(function (a, b) { return b.score - a.score; });
  let drawn = 0;
  for (let i = 0; i < candidates.length && drawn < EXTRA_CITY_LABEL_MAX; i++) {
    const c = candidates[i];
    ctx.save();
    textSize(c.size);
    const textW = ctx.measureText(c.m.name).width;
    ctx.restore();

    const rect = alignLeftRect(c.textX, c.ly, c.size, textW, c.alignLeft);
    if (markerRectOverlaps(rect)) continue;

    noStroke();
    fill(c.night ? 255 : 233, c.night ? 228 : 229, c.night ? 188 : 218, c.alpha * 0.72);
    circle(c.x, c.y, 1.8 + c.score * 0.45);
    noFill();
    stroke(c.night ? 255 : 227, c.night ? 214 : 160, c.night ? 156 : 76, c.alpha * 0.28);
    strokeWeight(0.65);
    line(c.x, c.y, c.textX - (c.alignLeft ? 3 : -3), c.ly);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.88)";
    ctx.shadowBlur = 5;
    noStroke();
    if (c.night) fill(255, 228, 188, c.alpha);
    else fill(233, 229, 218, c.alpha);
    textSize(c.size);
    textAlign(c.alignLeft ? LEFT : RIGHT, CENTER);
    text(c.m.name, c.textX, c.ly);
    ctx.restore();
    _markerLabelRects.push(rect);
    addCityHitTarget(c.m.name, c.x, c.y, rect);
    drawn++;
  }
}

function alignLeftRect(textX, y, size, width, alignLeft) {
  const x1 = alignLeft ? textX : textX - width;
  return { x1: x1 - 3, x2: x1 + width + 3, y1: y - size * 0.75, y2: y + size * 0.75 };
}

function addCityHitTarget(name, x, y, rect) {
  _cityHitTargets.push({ name: name, x: x, y: y, rect: rect });
}

function nearestAngle(current, target) {
  while (target - current > Math.PI) target -= TWO_PI;
  while (target - current < -Math.PI) target += TWO_PI;
  return target;
}

function startCityFocus(name) {
  const city = CITIES[name];
  if (!city) return;
  const keyIndex = KEY_CITIES.indexOf(name);
  if (keyIndex >= 0) keyCityIndex = keyIndex;
  if (!cityFocusReturn && !cityFocus) {
    cityFocusReturn = { rotX: rotX, rotY: rotY, zoom: zoomTarget };
  }
  const target = {
    rotX: -radians(city.lat),
    rotY: nearestAngle(rotY, -radians(city.lon)),
    zoom: CITY_FOCUS_ZOOM
  };
  routeFlashCity = name;
  routeFlashStart = millis();
  routeFlashUntil = routeFlashStart + CITY_ROUTE_FLASH_MS;
  cityFocus = {
    mode: "focus", name: name,
    start: { rotX: rotX, rotY: rotY, zoom: zoomTarget },
    target: target, t: 0,
    duration: reduceMotion ? 0.25 : CITY_FOCUS_SECONDS
  };
  if (cityModeActive) showObserverCity(name);
  spinX = spinY = 0;
}

function returnCityFocus() {
  if (cityModeActive) return;   // 观察者模式只能通过五指张合退出
  hideObserverCity();
  if (!cityFocus || !cityFocusReturn) return;
  const from = { rotX: rotX, rotY: rotY, zoom: zoomTarget };
  cityFocus = {
    mode: "return", name: "",
    start: from,
    target: {
      rotX: cityFocusReturn.rotX,
      rotY: nearestAngle(rotY, cityFocusReturn.rotY),
      zoom: cityFocusReturn.zoom
    },
    t: 0,
    duration: reduceMotion ? 0.25 : CITY_FOCUS_SECONDS
  };
  spinX = spinY = 0;
}

function cancelCityFocus() {
  if (cityModeActive) showObserverToast("退出观察者模式");
  hideObserverCity();
  cityFocus = null;
  cityFocusReturn = null;
  cityModeActive = false;
  cityModeLastSwitchAt = 0;
  spinX = spinY = 0;
}

function updateCityFocus(dtSec) {
  if (!cityFocus) return false;
  cityFocus.t += dtSec;
  const p = constrain(cityFocus.t / cityFocus.duration, 0, 1);
  const ease = 1 - Math.pow(1 - p, 3);
  rotX = cityFocus.start.rotX + (cityFocus.target.rotX - cityFocus.start.rotX) * ease;
  rotY = cityFocus.start.rotY + (cityFocus.target.rotY - cityFocus.start.rotY) * ease;
  zoomTarget = cityFocus.start.zoom + (cityFocus.target.zoom - cityFocus.start.zoom) * ease;
  spinX = spinY = 0;
  if (p >= 1) {
    if (cityFocus.mode === "return") {
      cityFocus = null;
      cityFocusReturn = null;
    }
  }
  return true;
}

function routeFlashAmount(name, nowMs) {
  if (!name || name !== routeFlashCity || nowMs > routeFlashUntil) return 0;
  const p = constrain((nowMs - routeFlashStart) / CITY_ROUTE_FLASH_MS, 0, 1);
  return Math.max(0, Math.sin(p * Math.PI * 3));
}

function updateObserverLabelBoosts(dtSec) {
  const targetCity = cityModeActive && cityFocus && cityFocus.mode === "focus"
    ? cityFocus.name
    : "";
  if (targetCity && observerLabelBoosts[targetCity] == null) {
    observerLabelBoosts[targetCity] = 0;
  }

  for (const name in observerLabelBoosts) {
    const current = observerLabelBoosts[name];
    const target = name === targetCity ? 1 : 0;
    const rate = target > current ? OBSERVER_LABEL_GROW_RATE : OBSERVER_LABEL_SHRINK_RATE;
    const next = current + (target - current) * (1 - Math.pow(1 - rate, dtScale));
    if (target === 0 && next < 0.002) delete observerLabelBoosts[name];
    else observerLabelBoosts[name] = next;
  }
}

function updateMotionBoost(dtSec) {
  if (reduceMotion) {
    motionBoost = 0;
    prevRotX = rotX;
    prevRotY = rotY;
    return;
  }
  const rotSpeed = Math.hypot(rotX - prevRotX, rotY - prevRotY) / Math.max(0.001, dtSec);
  const target = smoothStep01((rotSpeed - TRAIL_SPEED_MIN) / (TRAIL_SPEED_MAX - TRAIL_SPEED_MIN));
  const rate = target > motionBoost ? 0.18 : 0.055;
  motionBoost += (target - motionBoost) * (1 - Math.pow(1 - rate, dtScale));
  prevRotX = rotX;
  prevRotY = rotY;
}

function showMeteorShowerLabel() {
  const el = document.getElementById("meteor-shower-label");
  if (!el) return;
  el.classList.add("show");
  document.body.classList.add("shower-active");
  clearTimeout(showMeteorShowerLabel._timer);
  showMeteorShowerLabel._timer = setTimeout(function () {
    hideMeteorShowerLabel();
  }, METEOR_SHOWER_LABEL_MS);
}

function hideMeteorShowerLabel() {
  clearTimeout(showMeteorShowerLabel._timer);
  const el = document.getElementById("meteor-shower-label");
  if (el) el.classList.remove("show");
  document.body.classList.remove("shower-active");
}

function showObserverCity(name) {
  const el = document.getElementById("observer-city");
  const zh = document.getElementById("observer-city-zh");
  const en = document.getElementById("observer-city-en");
  if (!el || !zh || !en) return;
  zh.textContent = name;
  en.textContent = KEY_CITY_EN[name] || name;
  el.classList.add("show");
}

function hideObserverCity() {
  const el = document.getElementById("observer-city");
  if (el) el.classList.remove("show");
}

function showObserverToast(text) {
  const el = document.getElementById("observer-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(showObserverToast._timer);
  showObserverToast._timer = setTimeout(function () {
    el.classList.remove("show");
  }, 1600);
}

function chooseObserverEntryCity() {
  const D = 180 / Math.PI;
  const viewLon = ((-rotY * D + 540) % 360 + 360) % 360 - 180;
  const viewLat = constrain(-rotX * D, -90, 90);
  const viewVec = toXYZ(viewLat, viewLon);
  let bestName = OBSERVER_ENTRY_CITIES[0];
  let bestDot = -Infinity;

  for (let i = 0; i < OBSERVER_ENTRY_CITIES.length; i++) {
    const name = OBSERVER_ENTRY_CITIES[i];
    const city = CITIES[name];
    if (!city) continue;
    const vec = toXYZ(city.lat, city.lon);
    const dot = viewVec.x * vec.x + viewVec.y * vec.y + viewVec.z * vec.z;
    if (dot > bestDot) {
      bestDot = dot;
      bestName = name;
    }
  }
  return bestName;
}

function enterCityMode() {
  if (cityModeActive) return;
  cityModeActive = true;
  showObserverToast("进入观察者模式");
  cityModeSwipeArmed = true;
  cityModeStillFrames = 0;
  const firstCity = chooseObserverEntryCity();
  const firstIndex = KEY_CITIES.indexOf(firstCity);
  if (firstIndex >= 0) keyCityIndex = firstIndex;
  startCityFocus(firstCity);
}

function navigateKeyCity(direction) {
  const currentName = cityFocus && cityFocus.mode === "focus"
    ? cityFocus.name
    : KEY_CITIES[Math.max(0, keyCityIndex)];
  const currentCity = CITIES[currentName];
  if (!currentCity) {
    enterCityMode();
    return;
  }

  // 以“当前城市正好位于屏幕中心”的标准视角判断方向，
  // 不受镜头过渡中的中间姿态影响。
  const baseRotX = -radians(currentCity.lat);
  const baseRotY = -radians(currentCity.lon);
  const baseCr = Math.cos(baseRotX), baseSr = Math.sin(baseRotX);
  const baseCyw = Math.cos(baseRotY), baseSyw = Math.sin(baseRotY);
  const currentVec = toXYZ(currentCity.lat, currentCity.lon);
  const dirX = direction === "right" ? 1 : (direction === "left" ? -1 : 0);
  const dirY = direction === "down" ? 1 : (direction === "up" ? -1 : 0);

  function canonical(v) {
    const x1 = v.x * baseCyw + v.z * baseSyw;
    const z1 = -v.x * baseSyw + v.z * baseCyw;
    const y2 = v.y * baseCr - z1 * baseSr;
    const z2 = v.y * baseSr + z1 * baseCr;
    return { x: x1, y: y2, z: z2 };
  }

  const curQ = canonical(currentVec);
  let bestIndex = -1;
  let bestScore = Infinity;
  for (let i = 0; i < KEY_CITIES.length; i++) {
    const name = KEY_CITIES[i];
    if (name === currentName) continue;
    const city = CITIES[name];
    if (!city) continue;

    const vec = toXYZ(city.lat, city.lon);
    const q = canonical(vec);
    if (q.z < 0.06) continue;
    const sx = q.x - curQ.x, sy = q.y - curQ.y;
    const len = Math.hypot(sx, sy);
    if (len < 0.04) continue;
    const align = (sx * dirX + sy * dirY) / len;
    if (align < 0.18) continue;

    const dot = constrain(currentVec.x * vec.x + currentVec.y * vec.y + currentVec.z * vec.z, -1, 1);
    const angular = Math.acos(dot);
    const score = angular + (1 - align) * 0.55;
    if (score < bestScore) { bestScore = score; bestIndex = i; }
  }

  if (bestIndex < 0) {
    for (let i = 0; i < KEY_CITIES.length; i++) {
      if (KEY_CITIES[i] === currentName || !CITIES[KEY_CITIES[i]]) continue;
      const vec = toXYZ(CITIES[KEY_CITIES[i]].lat, CITIES[KEY_CITIES[i]].lon);
      const dot = constrain(currentVec.x * vec.x + currentVec.y * vec.y + currentVec.z * vec.z, -1, 1);
      const angular = Math.acos(dot);
      if (angular < bestScore) { bestScore = angular; bestIndex = i; }
    }
  }

  if (bestIndex >= 0) {
    keyCityIndex = bestIndex;
    startCityFocus(KEY_CITIES[bestIndex]);
  }
}

function exitCityMode() {
  if (cityModeActive) showObserverToast("退出观察者模式");
  hideObserverCity();
  cityModeActive = false;
  cityModeLastSwitchAt = 0;
  cityModeSwipeArmed = true;
  cityModeStillFrames = 0;
  cityFocus = null;
  cityFocusReturn = null;
  spinX = spinY = 0;
}

function handleCityClick(x, y) {
  for (let i = _cityHitTargets.length - 1; i >= 0; i--) {
    const c = _cityHitTargets[i];
    const nearPoint = Math.hypot(x - c.x, y - c.y) <= CITY_CLICK_RADIUS;
    const insideText = c.rect && x >= c.rect.x1 && x <= c.rect.x2 && y >= c.rect.y1 && y <= c.rect.y2;
    if (nearPoint || insideText) {
      startCityFocus(c.name);
      return;
    }
  }
  if (cityFocus && cityFocus.mode !== "return") returnCityFocus();
}

function drawMarkers() {
  const ctx = drawingContext;
  const R = gRot.R, cx = gRot.cx, cy = gRot.cy;
  _markerLabelRects.length = 0;

  for (let i = 0; i < places.length; i++) {
    const m = places[i];
    const q = project(toXYZ(m.lat, m.lon), gRot.cr, gRot.sr, gRot.cyw, gRot.syw, R, cx, cy);
    if (q.z < 0.06) continue;

    const lam = lamAt(q);
    const day = constrain((lam - 0.02) / 0.42, 0, 1);                  // 受光面
    const night = constrain((0.02 - lam) / 0.40, 0, 1) * constrain(q.z * 2.4, 0, 1); // 夜面
    const isCity = m.type === "city";

    // 国家只印在受光面；城市两面都标（夜面靠灯光那一层）
    if (!isCity && day <= 0.02) continue;
    if (isCity && day <= 0.02 && night <= 0.06) continue;

    const dx = q.x - cx, dy = q.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const lx = q.x + (dx / len) * 15;
    const ly = q.y + (dy / len) * 15;

    if (isCity && day > 0.02) {
      const lit = constrain(map(lam, -0.2, 0.8, 0.35, 1), 0.3, 1) * day;
      noStroke();
      fill(227, 160, 76, 250 * lit);              // 受光面：黄铜色站点标记
      circle(q.x, q.y, 4.2);
      noFill();
      stroke(227, 160, 76, 110 * lit);
      strokeWeight(0.8);
      circle(q.x, q.y, 9);
      stroke(227, 160, 76, 55 * lit);
      line(q.x, q.y, lx, ly);
    } else if (!isCity) {
      const lit = constrain(map(lam, -0.2, 0.8, 0.35, 1), 0.3, 1) * day;
      noFill();
      stroke(233, 229, 218, 78 * lit);
      strokeWeight(0.8);
      circle(q.x, q.y, 17);
      stroke(233, 229, 218, 38 * lit);
      line(q.x, q.y, lx, ly);
    } else {
      // 夜面城市：只留一条很短的引线，指向灯光
      noFill();
      stroke(255, 214, 156, 70 * night);
      strokeWeight(0.8);
      line(q.x, q.y, lx, ly);
    }

    // 文字：受光面象牙白；夜面暖白 + 深色外发光，保证在灯光上也看得清
    const onNight = isCity && day <= 0.02;
    const a = onNight ? 215 * night : (isCity ? 232 * day : 140 * day);
    if (a < 14) continue;

    const focus = isCity ? cityFocusAmount(q.x, q.y, cx, cy) : 0;
    const passPulse = isCity ? cityPulseAmount(m.name, millis()) : 0;
    const selectPulse = isCity && cityFocus && cityFocus.name === m.name ? routeFlashAmount(m.name, millis()) : 0;
    const textA = constrain(a + (255 - a) * focus * 0.92 + 34 * passPulse + 46 * selectPulse, 0, 255);
    const textX = dx >= 0 ? lx + 3 : lx - 3;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 6 + 4 * focus + 3 * selectPulse;
    noStroke();
    if (onNight) fill(255, 228, 188, textA);
    else fill(233, 229, 218, textA);
    const observerGrow = isCity ? (observerLabelBoosts[m.name] || 0) : 0;
    const size = (isCity ? 11.5 : 10.5) + (isCity ? CITY_FOCUS_MAX_SIZE * focus : 0) + 0.8 * passPulse + 1.2 * selectPulse + OBSERVER_LABEL_GROW_PX * observerGrow;
    textSize(size);
    textAlign(dx >= 0 ? LEFT : RIGHT, CENTER);
    const mainLabelWidth = ctx.measureText(m.name).width;
    const mainLabelRect = addMarkerLabelRect(textX, ly, size, mainLabelWidth, dx >= 0);
    if (isCity) addCityHitTarget(m.name, q.x, q.y, mainLabelRect);

    // 中央城市名加一层很薄的深色描边，压亮陆地或城市灯光时仍然清楚。
    if (focus > 0.02) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 0.6 + 1.8 * focus;
      ctx.strokeStyle = "rgba(3,6,12," + (0.58 * focus).toFixed(3) + ")";
      ctx.strokeText(m.name, textX, ly);
    }
    text(m.name, textX, ly);
    ctx.restore();
  }
  drawExtraCityLabels(ctx, cx, cy);
  textAlign(LEFT, BASELINE);
}

/* 仪器读数：只写真实数据 */
const _textCache = {};
function setText(id, text) {
  if (_textCache[id] === text) return;
  _textCache[id] = text;
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateReadout() {
  if (frameCount % 6 !== 0) return;              // DOM 写入很贵，隔几帧更新一次
  const D = 180 / Math.PI;
  let lon = ((-rotY * D + 540) % 360 + 360) % 360 - 180;   // 归一到 -180..180
  const lat = -rotX * D;
  setText("rd-lon", Math.abs(lon).toFixed(1) + "° " + (lon >= 0 ? "E" : "W"));
  setText("rd-lat", Math.abs(lat).toFixed(1) + "° " + (lat >= 0 ? "N" : "S"));
  setText("rd-zoom", zoom.toFixed(2) + "×");
  setText("rd-fps", (Math.round(cameraFps / 5) * 5) + " fps");
  setText("rd-land", ptsLand.length.toLocaleString());
  setText("rd-sea", ptsSea.length.toLocaleString());
  setText("rd-sat", (ORBITS.length + MOON_ORBITS.length) + " 颗");
  setText("rd-station", "1 座");
  setText("rd-moon", Math.round(moonPhase * 100) + "%");
  const flightVisible = forceFlights || zoom > 1.35;
  setText("rd-flight", flightVisible
    ? flightCount + " 架" + (forceFlights ? " · 强制" : "")
    : "放大后可见");
}

function drawStatus() {
  if (!cameraOk) setCamStatus("启动中");
  else if (!handReady) setCamStatus("画面运动模式");
  else if (handErrors >= 3) setCamStatus("识别出错");
  else if (millis() < victoryFeedbackUntil) setCamStatus("✌️ 流星雨");
  else if (usingHandsNow) setCamStatus("识别中 · " + handCount + " 只手");
  else setCamStatus("待机");

  if (!hasTexture) setStatus("没读到地球贴图 assets/earth.jpg，现在显示的是网格球");
  else if (!cameraOk) setStatus("摄像头未就绪，可先用鼠标拖拽");
  else setStatus("");
}

function ctx2d() {
  return drawingContext;
}

function drawDebug() {
  const w = detect.width * 2, h = detect.height * 2;
  const x = width - w - 20, y = 20;
  const ctx = drawingContext;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(detect, x, y, w, h);
  ctx.restore();

  noFill();
  stroke(120, 200, 255, 160);
  rect(x, y, w, h);
  noStroke();
  fill(160, 210, 255, 210);
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text("d：调试视图　运动点 " + motionCount + "　速度 " + motionVX.toFixed(3) + ", " + motionVY.toFixed(3), x, y - 6);
  textAlign(LEFT, BASELINE);
}

/* ==========================================================
   手部识别（MediaPipe Hands）
   ----------------------------------------------------------
   文件都在 assets/mediapipe/ 里，不联网也能跑。
   给出 21 个手部关键点 → 手掌位置（转）+ 拇指食指距离（缩放）
   ========================================================== */
function initHands() {
  if (typeof Hands === "undefined") {
    setStatus("⚠️ 没加载手部识别库 assets/mediapipe/hands.js");
    return;
  }
  try {
    hands = new Hands({ locateFile: (f) => "assets/mediapipe/" + f });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,        // 0 = 轻量模型（快一倍，够用）；1 = 完整模型（更准但更吃 CPU）
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
    hands.onResults(onHandResults);
    handReady = true;
  } catch (e) {
    setStatus("⚠️ 手部识别初始化失败：" + e.message);
  }
}

function feedHands() {
  if (!handReady || handsBusy || !cameraOk) return;
  if (frameCount % 2 !== 0) return;              // 隔帧送，省性能
  try {
    handsBusy = true;
    hands.send({ image: videoEl })
      .catch((err) => {
        handErrors++;
        if (handErrors === 3) {
          setStatus("⚠️ 手部识别出错：" + (err && err.message ? err.message : err));
        }
      })
      .then(() => { handsBusy = false; });
  } catch (e) {
    handsBusy = false;
  }
}

// 手心 = 手腕 + 四个掌指关节的平均
function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: x / ids.length, y: y / ids.length };
}

function handDist3(a, b) {
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

function fingerExtension(lm, tip, pip) {
  const wrist = lm[0];
  const dTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y);
  const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y) || 0.001;
  return dTip / dPip;
}

function fingerStraight(lm, tip, mcp) {
  const wx = lm[mcp].x - lm[0].x, wy = lm[mcp].y - lm[0].y;
  const fx = lm[tip].x - lm[mcp].x, fy = lm[tip].y - lm[mcp].y;
  const wLen = Math.hypot(wx, wy) || 0.001;
  const fLen = Math.hypot(fx, fy) || 0.001;
  return (wx * fx + wy * fy) / (wLen * fLen);
}

function isVictoryGesture(lm) {
  const palm = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.001;
  const split = Math.hypot(lm[8].x - lm[12].x, lm[8].y - lm[12].y) / palm;

  // 食指、中指伸直；无名指、小指收拢；两指之间有清楚的分叉。
  return fingerExtension(lm, 8, 6) > 1.10 &&
         fingerExtension(lm, 12, 10) > 1.10 &&
         fingerStraight(lm, 8, 5) > 0.56 &&
         fingerStraight(lm, 12, 9) > 0.56 &&
         fingerExtension(lm, 16, 14) < 1.04 &&
         fingerExtension(lm, 20, 18) < 1.04 &&
         split > 0.18;
}

function updateVictoryGesture(active) {
  const now = millis();
  if (!active) {
    victoryGestureActive = false;
    victoryTriggered = false;
    victoryHoldStart = 0;
    return;
  }

  if (!victoryGestureActive) {
    victoryGestureActive = true;
    victoryHoldStart = now;
    victoryTriggered = false;
  }

  if (!victoryTriggered && now - victoryHoldStart >= VICTORY_HOLD_MS && now >= victoryCooldownUntil) {
    triggerMeteorShower();
    victoryTriggered = true;
    victoryCooldownUntil = now + VICTORY_COOLDOWN_MS;
    victoryFeedbackUntil = now + SHOWER_GOLD_OPENING_SEC * 1000;
  }
}

function triggerMeteorShower() {
  const now = millis() / 1000;
  if (!reduceMotion) showMeteorShowerLabel();
  if (meteorShower) {
    meteorShower.endAt = Math.max(meteorShower.endAt, now + SHOWER_DURATION_MIN * 0.6);
    meteorShower.manual = true;
    meteorShower.goldBoostUntil = now + SHOWER_GOLD_OPENING_SEC;
  } else {
    startMeteorShower(now, true);
  }
  meteorShowerNextAt = now + random(SHOWER_GAP_MIN, SHOWER_GAP_MAX);
}

function updateHandDoublePinch(lm) {
  const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  const palm = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.001;
  const ratio = pinchDist / palm;

  // 食指和拇指靠拢，同时至少一根其他手指未收成拳头，避免和五指缩放混淆。
  let otherOpen = 0;
  if (fingerExtension(lm, 12, 10) > 1.02) otherOpen++;
  if (fingerExtension(lm, 16, 14) > 1.02) otherOpen++;
  if (fingerExtension(lm, 20, 18) > 1.02) otherOpen++;
  const pinchShape = ratio < HAND_PINCH_CLOSE_RATIO && otherOpen >= 1;
  const released = ratio > HAND_PINCH_RELEASE_RATIO || otherOpen < 1;

  if (pinchShape && !handPinchClosed) {
    handPinchClosed = true;
    const now = millis();
    handPinchCycleUntil = now + HAND_PINCH_BLOCK_MS;
    const gap = now - lastHandPinchAt;
    if (lastHandPinchAt > 0 && gap >= HAND_PINCH_MIN_GAP_MS && gap <= HAND_PINCH_DOUBLE_MS) {
      enterCityMode();
      lastHandPinchAt = 0;
    } else {
      lastHandPinchAt = now;
    }
  } else if (released) {
    handPinchClosed = false;
  }
}

function onHandResults(results) {
  handFrames++;
  let list = (results && results.multiHandLandmarks) || [];
  const handedness = (results && results.multiHandedness) || [];
  const handLabel = handedness[0] && handedness[0].label ? handedness[0].label : "";

  // 只锁定第一次识别到的那只手；另一只手进入画面时直接忽略。
  if (!lockedHandLabel && handLabel) lockedHandLabel = handLabel;
  if (list.length && lockedHandLabel && handLabel && handLabel !== lockedHandLabel) {
    list = [];
  }
  handCount = list.length;

  if (handCount === 0) {
    // 手离开画面：保留观察者模式和当前城市，手回来后再继续控制。
    handSeen = false;
    lastPalm = null;
    handZoom = null;
    handSmoothX = null;
    handSmoothY = null;
    handStillLocked = false;
    handYSign = 0;
    handYSignFrames = 0;
    handFieldTargetStrength = 0;
    lastFiveSpread = null;
    fiveZoomImpulse = 0;
    handPinchClosed = false;
    lastHandPinchAt = 0;
    handPinchCycleUntil = 0;
    victoryGestureActive = false;
    victoryTriggered = false;
    victoryHoldStart = 0;
    return;
  }

  handSeen = true;
  lastHandFrame = frameCount;
  silence = 0;

  // 单手比耶：连续保持一小段时间才触发流星雨，避免误触和重复触发。
  const victory = handCount === 1 && isVictoryGesture(list[0]);
  updateVictoryGesture(victory);
  if (victory) {
    lastPalm = null;
    handSmoothX = null;
    handSmoothY = null;
    handStillLocked = false;
    handYSign = 0;
    handYSignFrames = 0;
    handFieldTargetStrength = 0;
    lastFiveSpread = null;
    fiveZoomImpulse = 0;
    handPinchClosed = false;
    lastHandPinchAt = 0;
    handPinchCycleUntil = 0;
    handZoom = null;
    return;
  }

  if (handCount === 1) updateHandDoublePinch(list[0]);

  // —— 转动：先滤掉关键点的微小抖动，再保持原来的跟手比例 ——
  const p = palmCenter(list[0]);
  const mx = 1 - p.x, my = p.y;            // 镜像，方向才和画面对得上
  handFieldTargetX = mx * width;
  handFieldTargetY = my * height;
  handFieldTargetStrength = 1;

  if (handSmoothX == null) {
    handSmoothX = mx;
    handSmoothY = my;
  } else {
    const rawMove = Math.hypot(mx - handSmoothX, my - handSmoothY);
    const smoothAmount = constrain(
      map(rawMove, 0.0015, 0.018, HAND_FILTER_MIN, HAND_FILTER_MAX),
      HAND_FILTER_MIN, HAND_FILTER_MAX
    );
    handSmoothX += (mx - handSmoothX) * smoothAmount;
    handSmoothY += (my - handSmoothY) * smoothAmount;
  }

  let handMoveNow = 0;
  if (lastPalm) {
    let dx = handSmoothX - lastPalm.x;
    let dy = handSmoothY - lastPalm.y;
    const move = Math.hypot(dx, dy);
    handMoveNow = move;
    const stability = constrain((zoom - 1.30) / 0.90, 0, 1);
    const stillZone = HAND_STILL_BASE + HAND_STILL_ZOOM * stability;
    const wakeZone = stillZone * HAND_WAKE_MULT;

    // 小抖动直接锁住；明确移动时立即恢复原有灵敏度。
    if (handStillLocked) {
      if (move < wakeZone) {
        dx = 0; dy = 0;
      } else {
        handStillLocked = false;
      }
    } else if (move < stillZone) {
      handStillLocked = true;
      dx = 0; dy = 0;
    }

    // 横向和斜向转动时，过滤关键点上下方向的高频抖动。
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (absX > stillZone * 2 && absY > 0.00001) {
      const ySign = Math.sign(dy);
      if (ySign === handYSign) handYSignFrames++;
      else { handYSign = ySign; handYSignFrames = 1; }

      const yRatio = absY / Math.max(0.00001, absX);
      if (yRatio < HAND_VERTICAL_NOISE) {
        dy = 0;
      } else if (yRatio < HAND_VERTICAL_RATIO && handYSignFrames < HAND_VERTICAL_CONFIRM) {
        dy = 0;
      }
    } else {
      handYSign = 0;
      handYSignFrames = 0;
    }

    if (cityModeActive) {
      const nowMs = millis();
      const focusReady = !cityFocus || cityFocus.mode !== "focus" || cityFocus.t >= cityFocus.duration * CITY_MODE_FOCUS_READY;
      let observerExited = false;

      // 五指先聚拢，再在短时间窗口内轻晃两次即可退出。
      if (nowMs < fivePinchArmedUntil && move > CITY_MODE_SHAKE_DISTANCE) {
        const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
        const dir = axis === 0 ? Math.sign(dx) : Math.sign(dy);
        if (axis !== fivePinchShakeAxis) {
          fivePinchShakeAxis = axis;
          fivePinchShakeDir = dir;
          fivePinchShakeReversals = 0;
        } else if (dir !== 0 && dir !== fivePinchShakeDir) {
          fivePinchShakeDir = dir;
          fivePinchShakeReversals++;
        }
        if (fivePinchShakeReversals >= CITY_MODE_SHAKE_REVERSALS) {
          exitCityMode();
          observerExited = true;
          fivePinchExitFrames = 0;
          fivePinchArmedUntil = 0;
          fivePinchShakeAxis = -1;
          fivePinchShakeDir = 0;
          fivePinchShakeReversals = 0;
        }
      }

      if (!cityModeSwipeArmed) {
        if (move < CITY_MODE_REARM_DISTANCE) cityModeStillFrames++;
        else cityModeStillFrames = 0;
        if (cityModeStillFrames >= CITY_MODE_REARM_FRAMES &&
            nowMs - cityModeLastSwitchAt > CITY_MODE_SWIPE_COOLDOWN && focusReady) {
          cityModeSwipeArmed = true;
          cityModeStillFrames = 0;
        }
      } else if (!observerExited && move > CITY_MODE_SWIPE_DISTANCE &&
                 nowMs - cityModeLastSwitchAt > CITY_MODE_SWIPE_COOLDOWN && focusReady) {
        // 与手掌“拨动地球仪”的视觉方向保持一致：手势方向反转后选择城市。
        const direction = Math.abs(dx) >= Math.abs(dy)
          ? (dx >= 0 ? "left" : "right")
          : (dy >= 0 ? "up" : "down");
        navigateKeyCity(direction);
        cityModeLastSwitchAt = nowMs;
        cityModeSwipeArmed = false;
        cityModeStillFrames = 0;
        lastPalm = { x: handSmoothX, y: handSmoothY };
        lastPalmFrame = frameCount;
      }
      dx = 0; dy = 0;
      spinX = spinY = 0;
    } else if ((Math.abs(dx) > stillZone * 1.5 || Math.abs(dy) > stillZone * 1.5) && cityFocus) {
      cancelCityFocus();
    }

    rotY += dx * followX;
    rotX += dy * HAND_FOLLOW_Y * invertY;

    // 换算成「每帧速度」，并保留一点动量记忆：
    // 快速甩一下之后，就算手马上停住或离开画面，地球也会继续转
    const dtSec2 = Math.max(0.01, (frameCount - lastPalmFrame) * (deltaTime / 1000));
    const vx = (dx / dtSec2) * followX / 60;      // ÷60 → 单位是「每 1/60 秒转多少」
    const vy = (dy / dtSec2) * HAND_FOLLOW_Y * invertY / 60;
    spinY = spinY * MOMENTUM + vx * (1 - MOMENTUM);
    spinX = spinX * MOMENTUM + vy * (1 - MOMENTUM);

    // 放大观察时，锁定状态会更快刹住残留惯性，但不影响移动时的跟手。
    if (handStillLocked && stability > 0.05) {
      const damp = Math.pow(0.80, dtSec2 * 60);
      spinX *= damp;
      spinY *= damp;
      if (Math.abs(spinX) < 0.00008) spinX = 0;
      if (Math.abs(spinY) < 0.00008) spinY = 0;
    }
  }
  lastPalm = { x: handSmoothX, y: handSmoothY };
  lastPalmFrame = frameCount;

  // —— 缩放：单手五指聚合程度 ——
  // 手指不动 → 不缩；五指收拢 → 缩小；五指张开 → 放大。
  {
    const l = list[0];
    const tips = [4, 8, 12, 16, 20];
    let tipCX = 0, tipCY = 0;
    for (let i = 0; i < tips.length; i++) {
      tipCX += l[tips[i]].x;
      tipCY += l[tips[i]].y;
    }
    tipCX /= tips.length;
    tipCY /= tips.length;

    const palm = Math.hypot(l[0].x - l[9].x, l[0].y - l[9].y) || 0.001;
    let tipSpread = 0;
    for (let i = 0; i < tips.length; i++) {
      tipSpread += Math.hypot(l[tips[i]].x - tipCX, l[tips[i]].y - tipCY);
    }
    const fiveSpread = (tipSpread / tips.length) / palm;

    // 五指完全捏合：必须用三维坐标，避免横摆时指尖在屏幕上投影重叠造成误判。
    const palm3 = handDist3(l[0], l[9]) || 0.001;
    let tip3X = 0, tip3Y = 0, tip3Z = 0;
    for (let i = 0; i < tips.length; i++) {
      tip3X += l[tips[i]].x;
      tip3Y += l[tips[i]].y;
      tip3Z += (l[tips[i]].z || 0);
    }
    tip3X /= tips.length; tip3Y /= tips.length; tip3Z /= tips.length;

    let maxTipGap3 = 0;
    let maxTipGap2 = 0;
    let tipSpread3 = 0;
    for (let i = 0; i < tips.length; i++) {
      tipSpread3 += Math.hypot(l[tips[i]].x - tip3X, l[tips[i]].y - tip3Y, (l[tips[i]].z || 0) - tip3Z);
      for (let j = i + 1; j < tips.length; j++) {
        const gap3 = handDist3(l[tips[i]], l[tips[j]]);
        const gap2 = Math.hypot(l[tips[i]].x - l[tips[j]].x, l[tips[i]].y - l[tips[j]].y);
        if (gap3 > maxTipGap3) maxTipGap3 = gap3;
        if (gap2 > maxTipGap2) maxTipGap2 = gap2;
      }
    }
    tipSpread3 /= tips.length;
    const thumbIndex3 = handDist3(l[4], l[8]);
    const thumbIndex2 = Math.hypot(l[4].x - l[8].x, l[4].y - l[8].y);
    const fullFivePinch =
      maxTipGap3 / palm3 < 0.50 &&
      tipSpread3 / palm3 < 0.36 &&
      thumbIndex3 / palm3 < 0.40 &&
      maxTipGap2 / palm < 0.40 &&
      thumbIndex2 / palm < 0.34;

    if (cityModeActive) {
      // 全捏合先进入可退出状态；随后轻晃两次即可退出，持续全捏合仍作为备用。
      if (fullFivePinch) {
        const nowMs = millis();
        if (nowMs >= fivePinchArmedUntil) {
          fivePinchArmedUntil = nowMs + CITY_MODE_SHAKE_WINDOW_MS;
          fivePinchShakeAxis = -1;
          fivePinchShakeDir = 0;
          fivePinchShakeReversals = 0;
        }
        fivePinchExitFrames++;
      } else {
        fivePinchExitFrames = 0;
      }
      if (fivePinchExitFrames >= HAND_FIVE_PINCH_HOLD) {
        exitCityMode();
        fivePinchExitFrames = 0;
        fivePinchArmedUntil = 0;
        fivePinchShakeAxis = -1;
        fivePinchShakeDir = 0;
        fivePinchShakeReversals = 0;
        lastFiveSpread = null;
        fiveZoomImpulse = 0;
      }
    } else if (lastFiveSpread != null && handMoveNow < HAND_FIVE_MOVE_LIMIT && millis() >= handPinchCycleUntil) {
      const delta = fiveSpread - lastFiveSpread;
      if (Math.abs(delta) > HAND_FIVE_DEADZONE) {
        if (cityFocus) cancelCityFocus();
        const safeDelta = constrain(delta, -HAND_FIVE_MAX_DELTA, HAND_FIVE_MAX_DELTA);
        fiveZoomImpulse = constrain(fiveZoomImpulse + safeDelta * HAND_FIVE_GAIN, -2.5, 2.5);
      }
    }
    lastFiveSpread = fiveSpread;
  }

  handZoom = null;      // 不再用"绝对映射"，所以画面不会自己一路放大
}

/* ==========================================================
   摄像头：算运动方向和运动范围
   ========================================================== */
function readGesture() {
  const none = { vx: 0, vy: 0, n: 0, spread: spreadEMA };
  if (!camOn || !cameraOk) {
    motionVX = motionVY = 0;
    lastCX = lastCY = null;
    return none;
  }

  const aw = detect.width, ah = detect.height;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return none;

  // 1) 把摄像头画面铺满检测画布（镜像）
  const s = Math.max(aw / vw, ah / vh);
  const dw = vw * s, dh = vh * s;
  const dx = (aw - dw) / 2, dy = (ah - dh) / 2;

  dctx.save();
  dctx.globalAlpha = 1;
  dctx.translate(aw, 0);
  dctx.scale(-1, 1);
  dctx.drawImage(videoEl, dx, dy, dw, dh);
  dctx.restore();

  const now = dctx.getImageData(0, 0, aw, ah).data;
  if (!prevData) { prevData = now; return none; }

  // 2) 变化掩码：这一帧比上一帧变化了多少
  if (!maskBuf || maskBuf.length !== aw * ah) maskBuf = new Uint8Array(aw * ah);
  maskBuf.fill(0);

  for (let y = 1; y < ah - 1; y++) {
    for (let x = 1; x < aw - 1; x++) {
      const i = (y * aw + x) * 4;
      const d =
        Math.abs(now[i]     - prevData[i]) +
        Math.abs(now[i + 1] - prevData[i + 1]) +
        Math.abs(now[i + 2] - prevData[i + 2]);
      if (d > MOTION_MIN) maskBuf[y * aw + x] = 1;
    }
  }
  prevData = now;

  // 3) 去噪 + 求运动中心
  //    一个点周围 8 个邻居里至少 3 个也在动，才算真的「有东西在动」
  //    这一步是解决「画面自己抽动」的关键
  let sumX = 0, sumY = 0, n = 0;
  let minX = aw, maxX = 0, minY = ah, maxY = 0;

  for (let y = 1; y < ah - 1; y++) {
    for (let x = 1; x < aw - 1; x++) {
      if (!maskBuf[y * aw + x]) continue;

      const nb =
        maskBuf[(y - 1) * aw + (x - 1)] + maskBuf[(y - 1) * aw + x] + maskBuf[(y - 1) * aw + (x + 1)] +
        maskBuf[y * aw + (x - 1)]                                   + maskBuf[y * aw + (x + 1)] +
        maskBuf[(y + 1) * aw + (x - 1)] + maskBuf[(y + 1) * aw + x] + maskBuf[(y + 1) * aw + (x + 1)];

      if (nb < 3) continue;          // 孤立噪点，丢掉

      sumX += x; sumY += y; n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  motionCount = n;

  // 整幅画面都在变 → 是光线或曝光在动，不是手，忽略
  if (n > aw * ah * 0.4) {
    motionVX *= 0.5; motionVY *= 0.5;
    lastCX = lastCY = null;
    return none;
  }

  // 4) 运动中心的变化 → 速度
  let tx = 0, ty = 0;
  if (n >= MIN_MOTION) {
    const cxNow = sumX / n, cyNow = sumY / n;
    if (lastCX !== null) {
      tx = (cxNow - lastCX) / aw;
      ty = (cyNow - lastCY) / ah;
    }
    lastCX = cxNow; lastCY = cyNow;
  } else {
    // 手不在了：清空基准，下次重新出现时不会猛跳一下
    lastCX = lastCY = null;
  }

  const vs = pow(VEL_SMOOTH, dtScale);
  motionVX = motionVX * vs + tx * (1 - vs);
  motionVY = motionVY * vs + ty * (1 - vs);

  // 死区：细碎抖动直接归零
  if (Math.abs(motionVX) < DEADZONE) motionVX = 0;
  if (Math.abs(motionVY) < DEADZONE) motionVY = 0;

  // 5) 运动范围（判断「张开 / 收拢」用）
  if (n >= MIN_MOTION) {
    const bw = (maxX - minX + 1) / aw;
    const bh = (maxY - minY + 1) / ah;
    const spread = Math.min(1, Math.max(bw, bh));
    spreadEMA = spreadEMA * 0.92 + spread * 0.08;
  }

  return { vx: motionVX, vy: motionVY, n: n, spread: spreadEMA };
}

function cameraReady() {
  return videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0;
}

/* ==========================================================
   鼠标 / 键盘 / 窗口
   ========================================================== */
function mousePressed() {
  dragging = true;
  dragVX = dragVY = 0;
  mouseDownX = mouseX;
  mouseDownY = mouseY;
  mouseDownAt = millis();
  mouseMoved = false;
}

function mouseReleased() {
  dragging = false;
  const isClick = !mouseMoved &&
    Math.hypot(mouseX - mouseDownX, mouseY - mouseDownY) <= CITY_CLICK_MAX_MOVE &&
    millis() - mouseDownAt <= CITY_CLICK_MAX_MS;

  if (isClick) {
    handleCityClick(mouseX, mouseY);
    spinX = spinY = 0;
  } else {
    // 松手后继续转一点，像真的拨了一下地球仪
    spinY = dragVX * 0.35;
    spinX = dragVY * 0.35;
  }
  silence = 0;
}

function mouseDragged() {
  if (Math.hypot(mouseX - mouseDownX, mouseY - mouseDownY) > CITY_CLICK_MAX_MOVE) {
    mouseMoved = true;
  }
  if (cityFocus) cancelCityFocus();

  const dx = (mouseX - pmouseX) * 0.006;
  const dy = (mouseY - pmouseY) * 0.006 * invertY;
  rotY += dx;
  rotX += dy;
  rotX = constrain(rotX, -1.3, 1.3);
  dragVX = dx;
  dragVY = dy;
  spinX = spinY = 0;
}

function mouseWheel(event) {
  if (cityModeActive) return false;
  if (cityFocus) cancelCityFocus();
  zoomTarget = constrain(zoomTarget * (1 - event.delta * 0.0012), ZOOM_MIN, ZOOM_MAX);
  return false;      // 别让页面跟着滚
}

function keyPressed() {
  if (key === " ") autoSpin = !autoSpin;
  if (key === "c" || key === "C") {
    camOn = !camOn;
    prevData = null;      // 重新开始比较，避免开关瞬间画面乱跳
  }
  if (key === "d" || key === "D") showDebug = !showDebug;

  // f 强制显示/隐藏航线（默认要放大才出现，这个方便截图）
  if (key === "f" || key === "F") forceFlights = !forceFlights;

  // v 切换上下方向
  if (key === "v" || key === "V") invertY *= -1;

  // [ ] 随时调整左右灵敏度（调完看左上角显示的值）
  if (key === "[") followX = Math.max(0.5, followX - 0.2);
  if (key === "]") followX = Math.min(6.0, followX + 0.2);
  if (key === "r" || key === "R") {
    cancelCityFocus();
    rotX = -0.35; rotY = -1.8; spinX = spinY = 0; zoom = zoomTarget = 1;
  }
  if (key === "s" || key === "S") {
    const el = document.querySelector("canvas");
    if (!el) return;
    const a = document.createElement("a");
    a.href = el.toDataURL("image/png");
    a.download = "globe-" + Date.now() + ".png";
    a.click();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  background(4, 6, 12);
  setupDetect();
  buildStars();
}
