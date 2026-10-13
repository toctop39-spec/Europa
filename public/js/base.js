const canvas = document.getElementById('warCanvas');
const ctx = canvas.getContext('2d');

let width, height;

const PALETTE = {
    ocean: '#0d1322',
    player: '#1e3a8a',
    ally: '#166534',
    neutral: '#334155',
    enemy: '#991b1b',
    friendly: '#0891b2'
};

const OFF_W = 1600;
const OFF_H = 800;

const offCanvas = document.createElement('canvas');
offCanvas.width = OFF_W;
offCanvas.height = OFF_H;
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

// Create a higher resolution canvas for smoother rendering
const smoothCanvas = document.createElement('canvas');
smoothCanvas.width = OFF_W * 2;
smoothCanvas.height = OFF_H * 2;
const smoothCtx = smoothCanvas.getContext('2d');

const idCanvas = document.createElement('canvas');
idCanvas.width = OFF_W; 
idCanvas.height = OFF_H;
const idCtx = idCanvas.getContext('2d', { willReadFrequently: true });

let scale = 3.2;
let panX = 0;
let panY = 0;
let isDraggingPan = false;
let startPanX, startPanY;

let currentTool = 'inspect'; 
let currentTurn = 1;
let simDate = new Date(1939, 8, 1);

let territoryOwner = new Uint16Array(OFF_W * OFF_H);
let territoryOwnerPrevious = new Uint16Array(OFF_W * OFF_H); // For change detection

let countries = [];
let countryMap = {};
let playerCountryId = ''; // страна ЭТОГО игрока (пусто = наблюдатель). Во время симуляции временно подменяется (см. runAs в mp.js)
let favoriteCountries = new Set(); // For favorite countries

// Diplomatic relations system
let diplomaticRelations = {};

// Chat system
let chatMessages = {};

// Treaty system
let treaties = [];

// Credit system
let credits = [];

// Investment projects
let investmentProjects = [];

// Notifications system
let notifications = {};

// News events
let newsEvents = [];

// Country leaders
let countryLeaders = {};

let lastMouseX = 0;
let lastMouseY = 0;

// ==================== BUILDINGS / ARMY / WAR SYSTEM ====================
let buildings = []; // {id, type, x, y, ownerId, civRatio}
let buildingIdCounter = 1;
let activeWars = []; // {id, a, b, bbox:{minX,minY,maxX,maxY}, stats}
let warIdCounter = 1;
let warTroops = null;  // Float32Array(OFF_W*OFF_H) - garrison strength per pixel
let warSeeded = null;  // Uint8Array(OFF_W*OFF_H) - has this pixel been seeded with troops
let warOverlayCanvas, warOverlayCtx;
let convoys = []; // {id, ownerId, path:[[x,y],...], pathIndex, power, color, warId}
let convoyIdCounter = 1;
let constructionAnimationActive = false;

const BUILDING_TYPES = {
    supply:   { name: 'Центр снабжения',      color: '#22c55e', baseCost: 0.25 },
    defense:  { name: 'Оборонительный штаб',   color: '#3b82f6', baseCost: 0.35 },
    military: { name: 'Военный узел',          color: '#ef4444', baseCost: 0.45 }
};
const BUILD_TIME_DAYS = { supply: 3, defense: 3, military: 4 };
const BUILD_CLUSTER_RADIUS = 2;   // px in world grid - buildings closer than this add to density cost
const BUILD_CLUSTER_HARD_CAP = 7;  // at/above this many nearby, building here is blocked entirely

// Заводы и жилые районы - это просто цифры/бафы, без привязки к месту на карте
const ABSTRACT_TYPES = {
    factory: { name: 'Завод', baseCost: 0.35, buildDays: 4, outputPerUnit: 8 },
    housing: { name: 'Жилой район', baseCost: 0.15, buildDays: 3, manpowerBonusPerUnit: 1500, growthBonusPerUnit: 0.02 }
};
const BASE_PARTS_OUTPUT = 3;  // немного военных деталей идёт даже без единого завода
const BASE_CIV_OUTPUT = 2;    // и немного гражданской продукции тоже

const MANPOWER_OVERRIDES = { DEU: 100, RUS: 1000 }; // человек в день

function lonLatToOffscreen(lon, lat) {
    let x = (lon + 180) * (OFF_W / 360);
    let y = (90 - lat) * (OFF_H / 180);
    return { x, y };
}

function cleanupTerritoryNoise() {
    // A pixel whose owner ID matches none of its 4 direct neighbours is almost
    // certainly an anti-aliasing artifact from the polygon fill, not a real
    // one-pixel exclave. Snap it to whichever owner is most common among its
    // neighbours instead.
    let cleaned = territoryOwner.slice();
    for (let y = 0; y < OFF_H; y++) {
        let rowBase = y * OFF_W;
        for (let x = 0; x < OFF_W; x++) {
            let idx = rowBase + x;
            let id = territoryOwner[idx];
            let left = x > 0 ? territoryOwner[idx - 1] : id;
            let right = x < OFF_W - 1 ? territoryOwner[idx + 1] : id;
            let up = y > 0 ? territoryOwner[idx - OFF_W] : id;
            let down = y < OFF_H - 1 ? territoryOwner[idx + OFF_W] : id;
            if (id !== left && id !== right && id !== up && id !== down) {
                let counts = {};
                [left, right, up, down].forEach(n => { counts[n] = (counts[n] || 0) + 1; });
                let best = id, bestCount = 0;
                for (let k in counts) {
                    if (counts[k] > bestCount) { bestCount = counts[k]; best = Number(k); }
                }
                cleaned[idx] = best;
            }
        }
    }
    territoryOwner.set(cleaned);
}

async function initGrid() {
    try {
        let geoData = JSON.parse(document.getElementById('embeddedGeoData').textContent);

        offCtx.fillStyle = PALETTE.ocean;
        offCtx.fillRect(0, 0, OFF_W, OFF_H);

        countries = [];
        countryMap = {};
        let idxCounter = 1;

        geoData.features.forEach((feature) => {
            let cid = feature.id || feature.properties.iso_a3 || `CNT_${idxCounter}`;
            let name = feature.properties.name || cid;

            let countryObj = {
                numericId: idxCounter++,
                id: cid,
                name: name,
                polygons: []
            };

            countries.push(countryObj);
            countryMap[cid] = countryObj;

            const parseCoords = (coords) => {
                return coords.map(ring => ring.map(pt => lonLatToOffscreen(pt[0], pt[1])));
            };

            if (feature.geometry.type === 'Polygon') {
                countryObj.polygons = parseCoords(feature.geometry.coordinates);
            } else if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(poly => {
                    countryObj.polygons.push(...parseCoords(poly));
                });
            }
        });

        if (window.PRE_GRID) {
            // Готовая сетка владения (одинаковая у всех игроков), растеризация в браузере не нужна
            territoryOwner.set(window.PRE_GRID);
            territoryOwnerPrevious.set(window.PRE_GRID);
        } else {
            idCtx.fillStyle = '#000000';
            idCtx.fillRect(0, 0, OFF_W, OFF_H);

            countries.forEach(c => {
                idCtx.fillStyle = `rgb(${c.numericId & 255}, ${(c.numericId >> 8) & 255}, 10)`;
                c.polygons.forEach(ring => {
                    idCtx.beginPath();
                    ring.forEach((pt, i) => {
                        if (i === 0) idCtx.moveTo(pt.x, pt.y);
                        else idCtx.lineTo(pt.x, pt.y);
                    });
                    idCtx.closePath();
                    idCtx.fill();
                });
            });

            const idData = idCtx.getImageData(0, 0, OFF_W, OFF_H).data;
            for (let i = 0; i < OFF_W * OFF_H; i++) {
                let idx = i * 4;
                let id = idData[idx] + (idData[idx+1] << 8);
                territoryOwner[i] = id;
                territoryOwnerPrevious[i] = id; // Initialize previous state
            }

            // Canvas fill anti-aliasing blends edge-pixel colors between adjacent shapes,
            // which can decode to a completely unrelated country's numeric ID. Clean up
            // any single-pixel "islands" that don't match a single neighbour - these are
            // almost always rendering artifacts, not real exclaves.
            cleanupTerritoryNoise();
            cleanupTerritoryNoise();
        }

        initializeCountryData();

        warTroops = new Float32Array(OFF_W * OFF_H);
        warSeeded = new Uint8Array(OFF_W * OFF_H);
        warOverlayCanvas = document.createElement('canvas');
        warOverlayCanvas.width = OFF_W;
        warOverlayCanvas.height = OFF_H;
        warOverlayCtx = warOverlayCanvas.getContext('2d');

        renderOffscreenMap(); // This will generate initial borders
        renderCountryList();
        updatePlayerInfo();

        panX = width / 2 - (800 * scale);
        panY = height / 2 - (300 * scale);

        document.getElementById('loadingOverlay').style.display = 'none';
        draw();

    } catch (err) {
        console.error(err);
        document.getElementById('loadingStatusText').innerText = "Ошибка обработки карты мира. Откройте консоль браузера (F12) для деталей.";
    }
}

function initializeCountryData() {
    // Initialize diplomatic relations
    countries.forEach(c => {
        diplomaticRelations[c.id] = {};
        countries.forEach(other => {
            if (c.id !== other.id) {
                diplomaticRelations[c.id][other.id] = {
                    status: 'neutral', // neutral, friendly, hostile, allied, at_war
                    trust: 50,
                    influence: 0
                };
            }
        });
        
        // Initialize country economics
        c.economy = {
            budget: RNG() * 20 + 5, // 5-25 million
            population: RNG() * 100 + 10, // 10-110 million
            gdp: RNG() * 50 + 10, // 10-60 billion
            growth: (RNG() * 4 - 2), // -2% to +2%
            income: 0, // Daily income
            expenses: 0, // Daily expenses
            debt: 0, // National debt
            creditRating: 'AAA', // Credit rating
            taxRate: 20, // Tax rate percentage
            investmentPoints: 0, // Points for investment
            lastInvestmentTurn: 0
        };

        // Людские ресурсы (в тысячах человек) - у разных стран разный темп прироста
        let mpGrowth = MANPOWER_OVERRIDES[c.id] || 100; // дефолт 100 человек в день для всех кроме России
        c.economy.manpowerGrowth = mpGrowth;
        c.economy.manpowerCap = mpGrowth * 3000;
        c.economy.manpower = Math.round(mpGrowth * (500 + RNG() * 1000));

        // Армия и производство заводов
        c.army = { divisions: [] };
        c.militaryStock = 0; // накопленные военные детали с заводов, идут на дивизии и фронт
        c.factoryCount = 0;
        c.housingCount = 0;
        c.factoryCivRatio = 0.5;
        c.factoryQueue = []; // [{daysLeft}] - заводы/районы строятся не мгновенно
        c.housingQueue = [];

        // У ботов тоже есть базовая армия и небольшое военное производство,
        // иначе им нечем воевать
        if (c.id !== playerCountryId) {
            c.army.divisions.push({ id: 1, name: `${c.name} 1-я дивизия`, strength: 100, status: 'active', daysLeft: 0 });
            c.army.divisions.push({ id: 2, name: `${c.name} 2-я дивизия`, strength: 100, status: 'active', daysLeft: 0 });
        }

        // Initialize country influence
        c.influence = Math.floor(RNG() * 50 + 50); // 50-100
        
        // Initialize leader
        const leaderNames = ['Вильгельм', 'Адольф', 'Бенито', 'Иосиф', 'Франклин', 'Уинстон', 'Шарль', 'Хирохито', 'Антонио', 'Муссолини'];
        const leaderSurnames = ['Фон', 'Гитлер', 'Муссолини', 'Сталин', 'Рузвельт', 'Черчилль', 'де Голль', 'Хирохито', 'Салазар', 'Бадольо'];
        countryLeaders[c.id] = {
            name: leaderNames[Math.floor(RNG() * leaderNames.length)] + ' ' + 
                  leaderSurnames[Math.floor(RNG() * leaderSurnames.length)],
            ideology: ['фашизм', 'коммунизм', 'демократия', 'монархия'][Math.floor(RNG() * 4)],
            charisma: Math.floor(RNG() * 50 + 50),
            approval: Math.floor(RNG() * 40 + 40)
        };
        
        // Initialize chat
        chatMessages[c.id] = [];
    });
    
    // Initialize initial treaties
    createRandomTreaties();
    
    // Initialize initial news
    addNewsEvent('Мировая геополитика: Новая эра международных отношений начинается', 'world');
}

function hexToRgb(hex) {
    let n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Simple border drawing - just draw border pixels directly
function generateDynamicBorders() {
    console.log('Drawing simple borders...');
    
    let borderPixelCount = 0;
    
    // Draw borders directly on the smooth canvas with thinner, softer lines
    smoothCtx.fillStyle = 'rgba(15, 23, 42, 0.6)'; // Semi-transparent dark color
    
    for (let y = 0; y < OFF_H; y++) {
        for (let x = 0; x < OFF_W; x++) {
            let idx = y * OFF_W + x;
            let currentOwner = territoryOwner[idx];
            
            if (currentOwner === 0) continue; // Skip ocean
            
            // Check if this is a border pixel
            let neighbors = [
                {x: x+1, y: y}, {x: x-1, y: y},
                {x: x, y: y+1}, {x: x, y: y-1}
            ];
            
            let isBorder = false;
            neighbors.forEach(n => {
                if (n.x >= 0 && n.x < OFF_W && n.y >= 0 && n.y < OFF_H) {
                    let nIdx = n.y * OFF_W + n.x;
                    if (territoryOwner[nIdx] !== currentOwner) {
                        isBorder = true;
                    }
                } else {
                    isBorder = true; // Edge of map
                }
            });
            
            if (isBorder) {
                // Draw thinner border pixel (1x1 instead of 2x2)
                smoothCtx.fillRect(x * 2, y * 2, 1, 1);
                borderPixelCount++;
            }
        }
    }
    
    console.log(`Drew ${borderPixelCount} border pixels`);
}

// Simplify contour using Douglas-Peucker algorithm
function simplifyContour(points) {
    if (points.length < 3) return points;
    
    // Sort points to create a path
    let sorted = sortPointsClockwise(points);
    
    // Apply Douglas-Peucker simplification
    let epsilon = 2.0; // Simplification tolerance
    return douglasPeucker(sorted, epsilon);
}

function sortPointsClockwise(points) {
    if (points.length === 0) return [];
    
    // Find center
    let centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    let centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    // Sort by angle
    return points.slice().sort((a, b) => {
        let angleA = Math.atan2(a.y - centerY, a.x - centerX);
        let angleB = Math.atan2(b.y - centerY, b.x - centerX);
        return angleA - angleB;
    });
}

function douglasPeucker(points, epsilon) {
    if (points.length < 3) return points;
    
    let dmax = 0;
    let index = 0;
    let end = points.length - 1;
    
    for (let i = 1; i < end; i++) {
        let d = perpendicularDistance(points[i], points[0], points[end]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }
    
    if (dmax > epsilon) {
        let recResults1 = douglasPeucker(points.slice(0, index + 1), epsilon);
        let recResults2 = douglasPeucker(points.slice(index, end + 1), epsilon);
        
        return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
        return [points[0], points[end]];
    }
}

function perpendicularDistance(point, lineStart, lineEnd) {
    let dx = lineEnd.x - lineStart.x;
    let dy = lineEnd.y - lineStart.y;
    
    if (dx === 0 && dy === 0) {
        return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    }
    
    let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    
    if (t < 0) {
        return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    } else if (t > 1) {
        return Math.sqrt(Math.pow(point.x - lineEnd.x, 2) + Math.pow(point.y - lineEnd.y, 2));
    } else {
        let projX = lineStart.x + t * dx;
        let projY = lineStart.y + t * dy;
        return Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2));
    }
}

// Renders the map based on diplomatic relations
function renderOffscreenMap() {
    console.log('Rendering offscreen map...');
    
    let oceanRGB = hexToRgb(PALETTE.ocean);
    let colorByNumericId = new Array(countries.length + 1);
    countries.forEach(c => {
        let hex;
        if (c.id === playerCountryId) {
            hex = PALETTE.player;
        } else if (diplomaticRelations[playerCountryId] && diplomaticRelations[playerCountryId][c.id]) {
            let rel = diplomaticRelations[playerCountryId][c.id];
            if (rel.status === 'allied') hex = PALETTE.ally;
            else if (rel.status === 'friendly') hex = PALETTE.friendly;
            else if (rel.status === 'hostile' || rel.status === 'at_war') hex = PALETTE.enemy;
            else hex = PALETTE.neutral;
        } else {
            hex = PALETTE.neutral;
        }
        colorByNumericId[c.numericId] = hexToRgb(hex);
    });

    let imgData = offCtx.createImageData(OFF_W, OFF_H);
    let data = imgData.data;
    for (let i = 0, p = 0; i < OFF_W * OFF_H; i++, p += 4) {
        let rgb = colorByNumericId[territoryOwner[i]] || oceanRGB;
        data[p] = rgb[0]; data[p+1] = rgb[1]; data[p+2] = rgb[2]; data[p+3] = 255;
    }
    offCtx.putImageData(imgData, 0, 0);
    
    // Also update smooth canvas for better rendering
    smoothCtx.imageSmoothingEnabled = true;
    smoothCtx.imageSmoothingQuality = 'high';
    smoothCtx.drawImage(offCanvas, 0, 0, OFF_W * 2, OFF_H * 2);
    
    // Always generate borders for now (can optimize later)
    generateDynamicBorders();
    
    console.log('Offscreen map rendering complete');
}

function resizeCanvas() {
    const container = canvas.parentElement;
    width = container.clientWidth;
    height = container.clientHeight;
    canvas.width = width;
    canvas.height = height;
    draw();
}

function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(scale, scale);

    // 1. Base Map - draw from smooth canvas (with borders already drawn)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(smoothCanvas, 0, 0, OFF_W, OFF_H);

    // 1.5 War overlay - troop density / front lines
    if (warOverlayCanvas && activeWars.length > 0) {
        ctx.drawImage(warOverlayCanvas, 0, 0, OFF_W, OFF_H);
    }

    // 1.6 Buildings
    buildings.forEach(b => {
        let cfg = BUILDING_TYPES[b.type];
        if (!cfg) return;
        let s = 2;
        if (b.status === 'building') {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = cfg.color;
            ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
            ctx.globalAlpha = 1;
            // Крутящийся "молоток" - показывает, что объект ещё строится
            let angle = (performance.now() / 300) % (Math.PI * 2);
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(angle);
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 0.7 / scale;
            ctx.beginPath();
            ctx.moveTo(-3.2, 0); ctx.lineTo(2.2, 0);
            ctx.stroke();
            ctx.fillStyle = '#78350f';
            ctx.fillRect(2, -1.3, 2.2, 2.6);
            ctx.restore();
        } else {
            ctx.fillStyle = cfg.color;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 0.6 / scale;
            ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
            ctx.strokeRect(b.x - s / 2, b.y - s / 2, s, s);
        }
    });

    // 2. Country labels
    let fontSize = Math.max(8, Math.min(12, 10 / scale));
    ctx.font = `bold ${fontSize}px Verdana, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2 / scale;

    countries.forEach(c => {
        // Calculate center from original polygons
        if (c.polygons.length > 0 && c.polygons[0].length > 10) {
            let ring = c.polygons[0];
            let centerX = ring.reduce((sum, pt) => sum + pt.x, 0) / ring.length;
            let centerY = ring.reduce((sum, pt) => sum + pt.y, 0) / ring.length;
            
            ctx.strokeText(c.id, centerX, centerY);
            ctx.fillText(c.id, centerX, centerY);
        }
    });

    ctx.restore();
}

// RP Functions
function createRandomTreaties() {
    // Create some initial random treaties between countries
    const treatyTypes = ['trade', 'non_aggression', 'cultural_exchange'];
    const treatyNames = ['Торговое соглашение', 'Пакт о ненападении', 'Культурный обмен'];
    
    for (let i = 0; i < 5; i++) {
        const country1 = countries[Math.floor(RNG() * countries.length)];
        const country2 = countries[Math.floor(RNG() * countries.length)];
        
        if (country1.id !== country2.id) {
            const typeIndex = Math.floor(RNG() * treatyTypes.length);
            treaties.push({
                id: Date.now() + i,
                type: treatyTypes[typeIndex],
                name: treatyNames[typeIndex],
                parties: [country1.id, country2.id],
                startDate: new Date(simDate.getTime() - RNG() * 30 * 24 * 60 * 60 * 1000),
                status: 'active'
            });
        }
    }
}

function addNewsEvent(text, type = 'world') {
    newsEvents.unshift({
        id: Date.now(),
        text: text,
        type: type,
        date: new Date(simDate),
        turn: currentTurn
    });
    
    // Keep only last 50 events
    if (newsEvents.length > 50) {
        newsEvents = newsEvents.slice(0, 50);
    }
}

function getDiplomaticStatus(countryId) {
    if (!diplomaticRelations[playerCountryId] || !diplomaticRelations[playerCountryId][countryId]) {
        return 'neutral';
    }
    return diplomaticRelations[playerCountryId][countryId].status;
}

function setDiplomaticStatus(countryId, newStatus) {
    if (diplomaticRelations[playerCountryId] && diplomaticRelations[playerCountryId][countryId]) {
        diplomaticRelations[playerCountryId][countryId].status = newStatus;
        
        // Add news event
        const country = countryMap[countryId];
        const statusText = {
            'neutral': 'нейтральные',
            'friendly': 'дружественные',
            'hostile': 'враждебные',
            'allied': 'союзнические',
            'at_war': 'военные'
        };
        
        addNewsEvent(`${countryMap[playerCountryId].name} устанавливает ${statusText[newStatus]} отношения с ${country.name}`, 'diplomacy');
        
        renderOffscreenMap();
        draw();
    }
}

function sendChatMessage(targetCountryId, message) {
    const msg = {
        id: Date.now(),
        from: playerCountryId,
        to: targetCountryId,
        text: message,
        timestamp: new Date(simDate),
        turn: currentTurn
    };
    
    if (!chatMessages[targetCountryId]) {
        chatMessages[targetCountryId] = [];
    }
    chatMessages[targetCountryId].push(msg);
    
    // Add to player's chat as well
    if (!chatMessages[playerCountryId]) {
        chatMessages[playerCountryId] = [];
    }
    chatMessages[playerCountryId].push(msg);
    
    addNewsEvent(`${countryMap[playerCountryId].name} отправляет сообщение ${countryMap[targetCountryId].name}`, 'diplomacy');
}

function createTreaty(targetCountryId, treatyType) {
    const treatyNames = {
        'trade': 'Торговое соглашение',
        'non_aggression': 'Пакт о ненападении',
        'alliance': 'Военный союз',
        'cultural_exchange': 'Культурный обмен'
    };
    
    const treaty = {
        id: Date.now(),
        type: treatyType,
        name: treatyNames[treatyType],
        parties: [playerCountryId, targetCountryId],
        startDate: new Date(simDate),
        status: 'proposed'
    };
    
    treaties.push(treaty);
    addNewsEvent(`${countryMap[playerCountryId].name} предлагает ${countryMap[targetCountryId].name} заключить ${treaty.name}`, 'diplomacy');
}

function updateCountryEconomics() {
    countries.forEach(c => {
        if (c.economy) {
            // Calculate daily income based on GDP and tax rate
            let dailyIncome = (c.economy.gdp * c.economy.taxRate / 100) / 365;
            
            // Deduct reparations if applicable
            if (c.economy.reparations) {
                let reparationsAmount = dailyIncome * c.economy.reparations.percent;
                dailyIncome -= reparationsAmount;
                
                // Add reparations to the receiving country
                if (countryMap[c.economy.reparations.to]) {
                    let receiver = countryMap[c.economy.reparations.to];
                    if (receiver.economy) {
                        receiver.economy.budget += reparationsAmount;
                    }
                }
            }
            
            c.economy.income = dailyIncome;
            
            // Calculate daily expenses (military, administration, debt payments)
            let debtPayment = c.economy.debt > 0 ? (c.economy.debt * 0.001) : 0; // 0.1% daily interest
            let militarySpending = c.economy.gdp * 0.02 / 365; // 2% for military
            let adminSpending = c.economy.gdp * 0.01 / 365; // 1% for administration

            // Война стоит денег: чем больше войн и дивизий, тем дороже её вести каждый день
            let atWarCount = activeWars.filter(w => w.a === c.id || w.b === c.id).length;
            let activeDivisionsCount = c.army ? c.army.divisions.filter(d => d.status === 'active').length : 0;
            let warUpkeep = atWarCount > 0 ? (atWarCount * 0.35 + activeDivisionsCount * 0.06) * getCostMultiplier(c.id) : 0;

            c.economy.expenses = debtPayment + militarySpending + adminSpending + warUpkeep;
            
            // Net budget change
            let netChange = dailyIncome - c.economy.expenses;
            c.economy.budget += netChange;
            
            // Update debt
            if (c.economy.budget < 0) {
                c.economy.debt += Math.abs(c.economy.budget);
                c.economy.budget = 0;
            }
            
            // Pay off debt if budget is positive
            if (c.economy.budget > c.economy.debt * 0.1 && c.economy.debt > 0) {
                let payment = Math.min(c.economy.budget, c.economy.debt * 0.1);
                c.economy.debt -= payment;
                c.economy.budget -= payment;
            }
            
            // Economic growth based on relations, investments and random factors
            let growth = c.economy.growth;

            // Небольшой бонус к росту от жилых районов
            let housingCountForGrowth = buildings.filter(b => b.type === 'housing' && b.ownerId === c.id && b.status === 'active').length;
            growth += housingCountForGrowth * 0.02;
            
            // Boost from friendly relations
            if (diplomaticRelations[c.id]) {
                Object.values(diplomaticRelations[c.id]).forEach(rel => {
                    if (rel.status === 'friendly' || rel.status === 'allied') {
                        growth += 0.5;
                    } else if (rel.status === 'hostile' || rel.status === 'at_war') {
                        growth -= 0.3;
                    }
                });
            }
            
            // Инвестиции больше не дают постоянный бонус к росту навсегда - теперь
            // они созревают через какое-то время и выплачиваются один раз (см. processInvestments).
            growth = Math.max(-15, Math.min(15, growth)); // разумные пределы годового роста, чтобы экономика не улетала в квадриллионы

            c.economy.gdp *= (1 + growth / 100 / 365);
            c.economy.population *= (1 + growth / 200 / 365);
            
            // Update credit rating based on debt-to-GDP ratio
            let debtToGDP = c.economy.debt / c.economy.gdp;
            if (debtToGDP < 0.3) c.economy.creditRating = 'AAA';
            else if (debtToGDP < 0.5) c.economy.creditRating = 'AA';
            else if (debtToGDP < 0.7) c.economy.creditRating = 'A';
            else if (debtToGDP < 0.9) c.economy.creditRating = 'BBB';
            else if (debtToGDP < 1.2) c.economy.creditRating = 'BB';
            else c.economy.creditRating = 'CCC';
            
            // Update influence
            c.influence = Math.min(100, Math.max(0, c.influence + Math.floor(growth / 2)));

            // Прирост людских ресурсов (в реальных людях), до предела manpowerCap.
            // Жилые районы немного увеличивают прирост
            let populationFactor = Math.min(2, c.economy.population / 50); // до 2x прирост при большом населении
            let gdpFactor = Math.min(1.5, c.economy.gdp / 30); // до 1.5x прирост при большем ВВП
            let housingBonus = (c.housingCount || 0) * (5 + RNG() * 5) * populationFactor * gdpFactor;
            if (c.economy.manpower < c.economy.manpowerCap) {
                c.economy.manpower = Math.min(c.economy.manpowerCap, c.economy.manpower + c.economy.manpowerGrowth + housingBonus);
            }
            growth += (c.housingCount || 0) * (ABSTRACT_TYPES.housing.growthBonusPerUnit || 0);
        }

        // Стройка объектов на карте (снабжение/оборона/узел): не появляются мгновенно
        buildings.filter(b => b.ownerId === c.id && b.status === 'building').forEach(b => {
            b.daysLeft--;
            if (b.daysLeft <= 0) {
                b.status = 'active';
                if (c.id === playerCountryId) {
                    addNewsEvent(`Строительство "${BUILDING_TYPES[b.type].name}" завершено`, 'economy');
                }
            }
        });

        // Заводы и жилые районы строятся не мгновенно, но это просто цифры, без места на карте
        if (c.factoryQueue) {
            for (let i = c.factoryQueue.length - 1; i >= 0; i--) {
                c.factoryQueue[i].daysLeft--;
                if (c.factoryQueue[i].daysLeft <= 0) {
                    c.factoryCount = (c.factoryCount || 0) + 1;
                    c.factoryQueue.splice(i, 1);
                    if (c.id === playerCountryId) addNewsEvent(`Завод построен (всего: ${c.factoryCount})`, 'economy');
                }
            }
        }
        if (c.housingQueue) {
            for (let i = c.housingQueue.length - 1; i >= 0; i--) {
                c.housingQueue[i].daysLeft--;
                if (c.housingQueue[i].daysLeft <= 0) {
                    c.housingCount = (c.housingCount || 0) + 1;
                    c.housingQueue.splice(i, 1);
                    if (c.id === playerCountryId) addNewsEvent(`Жилой район построен (всего: ${c.housingCount})`, 'economy');
                }
            }
        }

        // Производство заводов: гражданские товары дают деньги, военные детали копятся для дивизий/фронта.
        // Небольшая база идёт даже без единого завода.
        if (c.factoryCount !== undefined) {
            let output = BASE_PARTS_OUTPUT + BASE_CIV_OUTPUT + c.factoryCount * ABSTRACT_TYPES.factory.outputPerUnit;
            let civOutput = output * c.factoryCivRatio;
            let milOutput = output * (1 - c.factoryCivRatio);
            if (c.economy) c.economy.budget += civOutput * 0.02;
            c.militaryStock = (c.militaryStock || 0) + milOutput;
        }

        // Прогресс обучения дивизий
        if (c.army) {
            c.army.divisions.forEach(d => {
                if (d.status === 'training') {
                    d.daysLeft--;
                    if (d.daysLeft <= 0) {
                        d.status = 'active';
                        if (c.id === playerCountryId) {
                            addNewsEvent(`Дивизия "${d.name}" завершила обучение и готова к бою`, 'war');
                        }
                    }
                }
            });
        }
    });

    processWars();
    processConvoys();
    processInvestments();
}

function screenToWorld(sx, sy) {
    let x = (sx - panX) / scale;
    let y = (sy - panY) / scale;
    return { x, y };
}

function getCountryAtPos(wPos) {
    let px = Math.floor(wPos.x); let py = Math.floor(wPos.y);
    if (px >= 0 && px < OFF_W && py >= 0 && py < OFF_H) {
        let id = territoryOwner[py * OFF_W + px];
        return countries.find(c => c.numericId === id);
    }
    return null;
}



// Mouse events for map interaction
canvas.addEventListener('mousedown', e => {
    let rect = canvas.getBoundingClientRect();
    lastMouseX = e.clientX - rect.left; lastMouseY = e.clientY - rect.top;
    let wPos = screenToWorld(lastMouseX, lastMouseY);

    if (e.button === 2 || e.button === 1 || e.shiftKey) {
        isDraggingPan = true;
        startPanX = lastMouseX - panX; startPanY = lastMouseY - panY;
        return;
    }

    if (e.button === 0) {
        // ЛКМ: если сдвинули мышь — это перетаскивание карты, если нет — обычный клик (инспекция/строительство)
        pendingClick = { sx: e.clientX, sy: e.clientY, wPos, px: lastMouseX - panX, py: lastMouseY - panY };
    }
});
let pendingClick = null;
function doMapClick(wPos) {
    let targetC = getCountryAtPos(wPos);
    if (currentTool === 'inspect' && targetC) {
        showCountryInfo(targetC);
    } else if (currentTool && currentTool.indexOf('build_') === 0) {
        tryPlaceBuilding(currentTool.replace('build_', ''), wPos, targetC);
    }
}

canvas.addEventListener('mousemove', e => {
    let rect = canvas.getBoundingClientRect();
    lastMouseX = e.clientX - rect.left; lastMouseY = e.clientY - rect.top;
    let wPos = screenToWorld(lastMouseX, lastMouseY);

    if (pendingClick && Math.hypot(e.clientX - pendingClick.sx, e.clientY - pendingClick.sy) > 5) {
        isDraggingPan = true; startPanX = pendingClick.px; startPanY = pendingClick.py; pendingClick = null;
    }
    if (isDraggingPan) {
        panX = lastMouseX - startPanX; panY = lastMouseY - startPanY;
        draw(); return;
    }
});

canvas.addEventListener('mouseup', e => {
    if (pendingClick && e.button === 0) { const w = pendingClick.wPos; pendingClick = null; doMapClick(w); }
    isDraggingPan = false;
});
canvas.addEventListener('mouseleave', () => { pendingClick = null; isDraggingPan = false; });

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    let zoom = e.deltaY < 0 ? 1.15 : 0.85;
    let wPosBefore = screenToWorld(lastMouseX, lastMouseY);
    scale = Math.min(Math.max(scale * zoom, 1.0), 14.0);
    panX = lastMouseX - wPosBefore.x * scale;
    panY = lastMouseY - wPosBefore.y * scale;
    draw();
}, { passive: false });

canvas.addEventListener('contextmenu', e => e.preventDefault());

function simulateOneDay() {
    currentTurn++;
    simDate.setDate(simDate.getDate() + 1);
    updateCountryEconomics();
    processCredits();
    randomAIActions();
    processTreatyProposals();
}

function refreshDateDisplays() {
    let monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    document.getElementById('dateDisplay').innerText = `${simDate.getDate().toString().padStart(2,'0')} ${monthNames[simDate.getMonth()]} ${simDate.getFullYear()}`;
    document.getElementById('turnDisplay').innerText = currentTurn;
    document.getElementById('headerTurn').innerText = currentTurn;
    document.getElementById('tickerTurn').innerText = currentTurn;
}

function advanceTurn() {
    simulateOneDay();
    refreshDateDisplays();
    updatePlayerInfo();
    renderOffscreenMap(); // This will regenerate borders only if territory changed
    draw();
}

function skipDays(n) {
    for (let i = 0; i < n; i++) {
        simulateOneDay();
    }
    refreshDateDisplays();
    updatePlayerInfo();
    renderOffscreenMap();
    draw();
    addNewsEvent(`Прошло ${n} дн. (сейчас день ${currentTurn})`, 'economy');
}

function randomAIActions() {
    // Боты не строят заводы, поэтому получают небольшой пассивный военный запас,
    // и время от времени формируют новую дивизию сами
    countries.forEach(c => {
        if (c.id === playerCountryId || !c.army) return;
        c.militaryStock = (c.militaryStock || 0) + 3;
        let activeDivisions = c.army.divisions.filter(d => d.status === 'active').length;
        if (activeDivisions < 10 && RNG() < 0.03) {
            let newId = c.army.divisions.length + 1;
            c.army.divisions.push({ id: newId, name: `${c.name} ${newId}-я дивизия`, strength: 100, status: 'active', daysLeft: 0 });
        }
    });

    // Random diplomatic changes
    countries.forEach(c => {
        if (c.id !== playerCountryId && RNG() < 0.1) {
            const targetCountry = countries[Math.floor(RNG() * countries.length)];
            if (targetCountry.id !== c.id && diplomaticRelations[c.id] && diplomaticRelations[c.id][targetCountry.id]) {
                const actions = ['neutral', 'friendly', 'hostile'];
                const newStatus = actions[Math.floor(RNG() * actions.length)];
                diplomaticRelations[c.id][targetCountry.id].status = newStatus;
                
                if (targetCountry.id === playerCountryId) {
                    addNewsEvent(`${c.name} изменяет отношение к ${countryMap[playerCountryId].name} на ${newStatus}`, 'diplomacy');
                }
            }
        }
    });
    
    // Random treaty proposals
    if (RNG() < 0.15) {
        const proposer = countries[Math.floor(RNG() * countries.length)];
        const target = countries[Math.floor(RNG() * countries.length)];
        
        if (proposer.id !== target.id && proposer.id !== playerCountryId) {
            const treatyTypes = ['trade', 'non_aggression', 'cultural_exchange'];
            const treatyNames = ['Торговое соглашение', 'Пакт о ненападении', 'Культурный обмен'];
            const typeIndex = Math.floor(RNG() * treatyTypes.length);
            
            treaties.push({
                id: Date.now(),
                type: treatyTypes[typeIndex],
                name: treatyNames[typeIndex],
                parties: [proposer.id, target.id],
                startDate: new Date(simDate),
                status: 'proposed'
            });
            
            if (target.id === playerCountryId) {
                addNewsEvent(`${proposer.name} предлагает ${countryMap[playerCountryId].name} заключить ${treatyNames[typeIndex]}`, 'diplomacy');
            }
        }
    }
}

function processTreatyProposals() {
    // Randomly accept/reject treaty proposals
    treaties.forEach(treaty => {
        if (treaty.status === 'proposed' && RNG() < 0.3) {
            if (RNG() < 0.6) {
                treaty.status = 'active';
                if (treaty.parties.includes(playerCountryId)) {
                    const otherParty = treaty.parties.find(id => id !== playerCountryId);
                    addNewsEvent(`${countryMap[playerCountryId].name} и ${countryMap[otherParty].name} подписали ${treaty.name}`, 'diplomacy');
                    
                    // Update diplomatic relations
                    if (treaty.type === 'alliance') {
                        setDiplomaticStatus(otherParty, 'allied');
                    } else if (treaty.type === 'non_aggression') {
                        setDiplomaticStatus(otherParty, 'friendly');
                    } else {
                        setDiplomaticStatus(otherParty, 'friendly');
                    }
                }
            } else {
                treaty.status = 'rejected';
                if (treaty.parties.includes(playerCountryId)) {
                    const otherParty = treaty.parties.find(id => id !== playerCountryId);
                    addNewsEvent(`${countryMap[otherParty].name} отклонил ${treaty.name} с ${countryMap[playerCountryId].name}`, 'diplomacy');
                }
            }
        }
    });
    
    // Process custom treaty notifications
    Object.keys(notifications).forEach(countryId => {
        notifications[countryId].forEach((notif, index) => {
            if (notif.type === 'treaty_guarantee_request' && RNG() < 0.4) {
                // AI response to guarantee request
                if (RNG() < 0.5) {
                    acceptTreatyGuarantee(notif.treatyId, countryId);
                } else {
                    rejectTreatyGuarantee(notif.treatyId, countryId);
                }
            }
        });
    });
}

// Investment functions
const INVESTMENT_TYPES = {
    bonds:   { name: 'Гособлигации',   minDays: 6,  maxDays: 12, minReturn: 0.04, maxReturn: 0.08, failChance: 0.03 },
    infra:   { name: 'Инфраструктура', minDays: 12, maxDays: 22, minReturn: 0.10, maxReturn: 0.18, failChance: 0.10 },
    tech:    { name: 'Технологии',     minDays: 18, maxDays: 32, minReturn: 0.18, maxReturn: 0.40, failChance: 0.20 },
    startup: { name: 'Стартапы',       minDays: 8,  maxDays: 26, minReturn: 0.10, maxReturn: 0.70, failChance: 0.35 }
};
let investmentIdCounter = 1;

function processInvestments() {
    investmentProjects.forEach(inv => {
        if (inv.status !== 'active') return;
        if (currentTurn >= inv.maturityTurn) {
            let owner = countryMap[inv.ownerId];
            if (RNG() < inv.failChance) {
                inv.status = 'failed';
                let salvage = inv.amount * (0.1 + RNG() * 0.3);
                if (owner && owner.economy) owner.economy.budget += salvage;
                if (inv.ownerId === playerCountryId) {
                    addNewsEvent(`Инвестиция "${inv.name}" провалилась! Удалось спасти $${salvage.toFixed(2)}M из $${inv.amount.toFixed(2)}M`, 'economy');
                    updatePlayerInfo();
                }
            } else {
                inv.status = 'matured';
                let payout = inv.amount * (1 + inv.returnPct);
                if (owner && owner.economy) owner.economy.budget += payout;
                if (inv.ownerId === playerCountryId) {
                    addNewsEvent(`Инвестиция "${inv.name}" созрела: $${payout.toFixed(2)}M (+${Math.round(inv.returnPct * 100)}%)`, 'economy');
                    updatePlayerInfo();
                }
            }
        }
    });
}

// Credit functions
function requestCredit(targetCountryId, amount, interestRate, duration) {
    let player = countryMap[playerCountryId];
    let target = countryMap[targetCountryId];
    
    if (!player || !target || !player.economy || !target.economy) return;
    
    if (target.economy.budget < amount) {
        alertBox('Ошибка', `${target.name} не имеет достаточных средств для кредита!`);
        return;
    }
    
    credits.push({
        id: Date.now(),
        lender: targetCountryId,
        borrower: playerCountryId,
        amount: amount,
        interestRate: interestRate,
        duration: duration, // in days
        startDate: new Date(simDate),
        endDate: new Date(simDate.getTime() + duration * 24 * 60 * 60 * 1000),
        status: 'proposed',
        remainingAmount: amount
    });
    
    // Send notification to lender
    sendNotification(targetCountryId, {
        type: 'credit_request',
        creditId: credits[credits.length - 1].id,
        from: playerCountryId,
        amount: amount,
        interestRate: interestRate,
        duration: duration
    });
    
    addNewsEvent(`${player.name} запрашивает кредит $${amount.toFixed(1)}M у ${target.name}`, 'economy');
}

function acceptCredit(creditId) {
    let credit = credits.find(c => c.id === creditId);
    if (!credit) return;
    
    let lender = countryMap[credit.lender];
    let borrower = countryMap[credit.borrower];
    
    if (lender && lender.economy && lender.economy.budget >= credit.amount) {
        lender.economy.budget -= credit.amount;
        borrower.economy.budget += credit.amount;
        borrower.economy.debt += credit.amount;
        
        credit.status = 'active';
        
        addNewsEvent(`${lender.name} одобрил кредит для ${borrower.name}`, 'economy');
        updatePlayerInfo();
    }
}

function rejectCredit(creditId) {
    let credit = credits.find(c => c.id === creditId);
    if (credit) {
        credit.status = 'rejected';
        let lender = countryMap[credit.lender];
        let borrower = countryMap[credit.borrower];
        addNewsEvent(`${lender.name} отклонил кредит для ${borrower.name}`, 'economy');
    }
}

function processCredits() {
    credits.forEach(credit => {
        if (credit.status === 'active') {
            let borrower = countryMap[credit.borrower];
            let lender = countryMap[credit.lender];
            
            if (borrower && lender && borrower.economy && lender.economy) {
                // Daily interest payment (amount is in millions, so calculate appropriately)
                let dailyInterest = credit.amount * (credit.interestRate / 100) / 365;
                
                if (borrower.economy.budget >= dailyInterest) {
                    borrower.economy.budget -= dailyInterest;
                    lender.economy.budget += dailyInterest;
                } else {
                    // Default on payment
                    credit.status = 'defaulted';
                    addNewsEvent(`${borrower.name} не смог выплатить процент по кредиту ${lender.name}`, 'economy');
                }
                
                // Check if credit is due
                if (simDate >= credit.endDate) {
                    if (borrower.economy.budget >= credit.remainingAmount) {
                        borrower.economy.budget -= credit.remainingAmount;
                        lender.economy.budget += credit.remainingAmount;
                        borrower.economy.debt -= credit.remainingAmount;
                        credit.status = 'paid';
                        addNewsEvent(`${borrower.name} полностью погасил кредит ${lender.name}`, 'economy');
                    } else {
                        credit.status = 'defaulted';
                        addNewsEvent(`${borrower.name} дефолт по кредиту ${lender.name}`, 'economy');
                    }
                }
            }
        }
    });
}

// Custom treaty functions
function createCustomTreaty(name, content, parties, guarantors) {
    let treaty = {
        id: Date.now(),
        type: 'custom',
        name: name,
        content: content,
        parties: parties,
        guarantors: guarantors, // Countries that guarantee execution
        startDate: new Date(simDate),
        status: 'proposed',
        createdBy: playerCountryId
    };
    
    treaties.push(treaty);
    
    // Send notifications to guarantors
    guarantors.forEach(guarantorId => {
        sendNotification(guarantorId, {
            type: 'treaty_guarantee_request',
            treatyId: treaty.id,
            from: playerCountryId,
            treatyName: name
        });
    });
    
    // Send notifications to other parties
    parties.forEach(partyId => {
        if (partyId !== playerCountryId) {
            sendNotification(partyId, {
                type: 'custom_treaty_proposal',
                treatyId: treaty.id,
                from: playerCountryId,
                treatyName: name
            });
        }
    });
    
    addNewsEvent(`${countryMap[playerCountryId].name} предлагает кастомный договор "${name}"`, 'diplomacy');
}

function acceptTreatyGuarantee(treatyId, guarantorId) {
    let treaty = treaties.find(t => t.id === treatyId);
    if (treaty && !treaty.guarantors.includes(guarantorId)) {
        treaty.guarantors.push(guarantorId);
        addNewsEvent(`${countryMap[guarantorId].name} гарантирует выполнение договора "${treaty.name}"`, 'diplomacy');
    }
}

function rejectTreatyGuarantee(treatyId, guarantorId) {
    let treaty = treaties.find(t => t.id === treatyId);
    if (treaty) {
        addNewsEvent(`${countryMap[guarantorId].name} отказался гарантировать договор "${treaty.name}"`, 'diplomacy');
    }
}

// Notification functions
function sendNotification(countryId, notification) {
    if (!notifications[countryId]) {
        notifications[countryId] = [];
    }
    notifications[countryId].push({
        id: Date.now(),
        ...notification,
        timestamp: new Date(simDate),
        read: false
    });
}

function getNotifications(countryId) {
    return notifications[countryId] || [];
}

function markNotificationRead(countryId, notificationId) {
    if (notifications[countryId]) {
        let notif = notifications[countryId].find(n => n.id === notificationId);
        if (notif) {
            notif.read = true;
        }
    }
}

function setTool(t) {
    currentTool = t;
    ['toolInspect'].forEach(id => {
        if (document.getElementById(id)) {
            document.getElementById(id).classList.remove('active-tool');
        }
    });
    if (document.getElementById(`tool${t.charAt(0).toUpperCase() + t.slice(1)}`)) {
        document.getElementById(`tool${t.charAt(0).toUpperCase() + t.slice(1)}`).classList.add('active-tool');
    }
}

function resetCamera() {
    scale = 3.2;
    panX = width / 2 - (800 * scale);
    panY = height / 2 - (300 * scale);
    draw();
}

function updatePlayerInfo() {
    let c = countryMap[playerCountryId];
    if (c) {
        document.getElementById('playerCountryBadge').innerText = c.name;
        
        if (c.economy) {
            document.getElementById('budgetDisplay').innerText = `$${c.economy.budget.toFixed(1)}M`;
            document.getElementById('incomeDisplay').innerText = `+$${c.economy.income.toFixed(2)}M`;
            document.getElementById('expensesDisplay').innerText = `-$${c.economy.expenses.toFixed(2)}M`;
            document.getElementById('debtDisplay').innerText = `$${c.economy.debt.toFixed(1)}M`;
            document.getElementById('creditRatingDisplay').innerText = c.economy.creditRating;
            document.getElementById('taxRateDisplay').innerText = `${c.economy.taxRate}%`;
            document.getElementById('populationDisplay').innerText = `${c.economy.population.toFixed(1)}M`;
            document.getElementById('gdpDisplay').innerText = `$${c.economy.gdp.toFixed(1)}B`;
            document.getElementById('manpowerDisplay').innerText = `${Math.round(c.economy.manpower).toLocaleString('ru-RU')} (+${c.economy.manpowerGrowth.toLocaleString('ru-RU')}/д)`;
        }
        
        document.getElementById('influenceDisplay').innerText = c.influence;
        document.getElementById('influenceBar').style.width = `${c.influence}%`;
        
        renderOffscreenMap();
    }
}

function renderCountryList() {
    let container = document.getElementById('countryListContainer');
    container.innerHTML = '';
    
    let searchTerm = document.getElementById('countrySearch').value.toLowerCase();
    
    // Separate favorites and others
    let favorites = [];
    let others = [];
    
    countries.forEach(c => {
        let matchesSearch = c.name.toLowerCase().includes(searchTerm) || c.id.toLowerCase().includes(searchTerm);
        if (matchesSearch) {
            if (favoriteCountries.has(c.id)) {
                favorites.push(c);
            } else {
                others.push(c);
            }
        }
    });
    
    // Sort favorites first, then others
    favorites.sort((a,b)=>a.name.localeCompare(b.name));
    others.sort((a,b)=>a.name.localeCompare(b.name));
    
    // Render favorites
    if (favorites.length > 0) {
        let favHeader = document.createElement('div');
        favHeader.style.cssText = 'font-size:9px; color:#f59e0b; font-weight:bold; margin:4px 0 2px 0;';
        favHeader.innerText = 'ИЗБРАННОЕ';
        container.appendChild(favHeader);
        
        favorites.forEach(c => {
            let btn = document.createElement('button');
            btn.className = `btn ${c.id === playerCountryId ? 'green' : ''}`;
            btn.innerHTML = `${c.name} ${c.id === playerCountryId ? '(ВЫ)' : ''}`;
            btn.onclick = () => {
                playerCountryId = c.id;
                updatePlayerInfo();
                renderCountryList();
                draw();
            };
            container.appendChild(btn);
        });
    }
    
    // Render others
    if (others.length > 0) {
        if (favorites.length > 0) {
            let otherHeader = document.createElement('div');
            otherHeader.style.cssText = 'font-size:9px; color:#64748b; font-weight:bold; margin:6px 0 2px 0;';
            otherHeader.innerText = 'ДРУГИЕ СТРАНЫ';
            container.appendChild(otherHeader);
        }
        
        others.forEach(c => {
            let btn = document.createElement('button');
            btn.className = `btn ${c.id === playerCountryId ? 'green' : ''}`;
            btn.innerHTML = `● ${c.name} ${c.id === playerCountryId ? '(ВЫ)' : ''}`;
            btn.onclick = () => {
                playerCountryId = c.id;
                updatePlayerInfo();
                renderCountryList();
                draw();
            };
            container.appendChild(btn);
        });
    }
    
    if (favorites.length === 0 && others.length === 0) {
        let noResults = document.createElement('div');
        noResults.style.cssText = 'text-align:center; padding:8px; color:#64748b; font-size:9px;';
        noResults.innerText = 'Ничего не найдено';
        container.appendChild(noResults);
    }
}

function filterCountryList() {
    renderCountryList();
}

function toggleFavoriteCountry(countryId) {
    if (favoriteCountries.has(countryId)) {
        favoriteCountries.delete(countryId);
    } else {
        favoriteCountries.add(countryId);
    }
    renderCountryList();
}

function showCountryInfo(country) {
    const rel = diplomaticRelations[playerCountryId] && diplomaticRelations[playerCountryId][country.id] 
        ? diplomaticRelations[playerCountryId][country.id] 
        : { status: 'neutral', trust: 50, influence: 0 };
    
    const leader = countryLeaders[country.id] || { name: 'Неизвестно', ideology: 'Неизвестно', charisma: 50, approval: 50 };
    
    const economy = country.economy || { budget: 0, population: 0, gdp: 0, growth: 0 };
    
    const statusText = {
        'neutral': 'Нейтральные',
        'friendly': 'Дружественные',
        'hostile': 'Враждебные',
        'allied': 'Союзнические',
        'at_war': 'Война'
    };
    
    let info = `Страна: ${country.name} (${country.id})
Лидер: ${leader.name} (${leader.ideology})
Харизма: ${leader.charisma}% | Поддержка: ${leader.approval}%

--- ЭКОНОМИКА ---
Бюджет: $${economy.budget.toFixed(1)}M
Население: ${economy.population.toFixed(1)}M
ВВП: $${economy.gdp.toFixed(1)}B
Рост: ${economy.growth.toFixed(1)}%

--- ДИПЛОМАТИЯ ---
Статус: ${statusText[rel.status] || 'Нейтральные'}
Доверие: ${rel.trust}%
Влияние: ${rel.influence}

--- ВОЗМОЖНЫЕ ДЕЙСТВИЯ ---
1. Изменить статус отношений
2. Отправить сообщение
3. Предложить договор`;
    
    alertBox(`Информация: ${country.name}`, info);
}

function openDiplomacyModal() {
    let container = document.getElementById('diplomacyContent');
    container.innerHTML = '<input type="text" id="diplomacySearch" placeholder="Поиск страны..." oninput="filterDiplomacyList()" style="width:100%; font-family:Verdana; font-size:10px; padding:3px; margin-bottom:6px;">';
    
    let contentDiv = document.createElement('div');
    contentDiv.id = 'diplomacyListContent';
    container.appendChild(contentDiv);
    
    filterDiplomacyList();
    document.getElementById('diplomacyModal').style.display = 'flex';
}

function filterDiplomacyList() {
    let container = document.getElementById('diplomacyListContent');
    container.innerHTML = '';
    
    let searchTerm = document.getElementById('diplomacySearch').value.toLowerCase();
    
    // Separate favorites and others
    let favorites = [];
    let others = [];
    
    countries.forEach(c => {
        if (c.id === playerCountryId) return;
        
        let matchesSearch = c.name.toLowerCase().includes(searchTerm) || c.id.toLowerCase().includes(searchTerm);
        if (matchesSearch) {
            if (favoriteCountries.has(c.id)) {
                favorites.push(c);
            } else {
                others.push(c);
            }
        }
    });
    
    favorites.sort((a,b)=>a.name.localeCompare(b.name));
    others.sort((a,b)=>a.name.localeCompare(b.name));
    
    const renderCountry = (c) => {
        let rel = diplomaticRelations[playerCountryId] && diplomaticRelations[playerCountryId][c.id] 
            ? diplomaticRelations[playerCountryId][c.id] 
            : { status: 'neutral', trust: 50, influence: 0 };
        
        const statusColors = {
            'neutral': '#64748b',
            'friendly': '#166534',
            'hostile': '#991b1b',
            'allied': '#0891b2',
            'at_war': '#dc2626'
        };
        
        const statusNames = {
            'neutral': 'Нейтральные',
            'friendly': 'Дружественные',
            'hostile': 'Враждебные',
            'allied': 'Союзнические',
            'at_war': 'Война'
        };
        
        let div = document.createElement('div');
        div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc;';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong>${c.name}</strong>
                <span style="color:${statusColors[rel.status]}; font-size:9px;">${statusNames[rel.status]}</span>
            </div>
            <div style="font-size:9px; margin-bottom:4px;">
                Доверие: ${rel.trust}% | Влияние: ${rel.influence}
            </div>
            <div style="display:flex; gap:2px; flex-wrap:wrap;">
                <button onclick="setDiplomaticStatus('${c.id}', 'neutral')" class="btn small" style="flex:1;">Нейтрально</button>
                <button onclick="setDiplomaticStatus('${c.id}', 'friendly')" class="btn small" style="flex:1;">Дружественно</button>
                <button onclick="setDiplomaticStatus('${c.id}', 'hostile')" class="btn small red" style="flex:1;">Враждебно</button>
                <button onclick="setDiplomaticStatus('${c.id}', 'allied')" class="btn small" style="flex:1;">Союз</button>
                <button onclick="toggleFavoriteCountry('${c.id}')" class="btn small" style="flex:1;">${favoriteCountries.has(c.id) ? 'Убрать из избранного' : 'В избранное'}</button>
            </div>
        `;
        return div;
    };
    
    // Render favorites
    if (favorites.length > 0) {
        let favHeader = document.createElement('div');
        favHeader.style.cssText = 'font-size:9px; color:#f59e0b; font-weight:bold; margin:4px 0 2px 0;';
        favHeader.innerText = 'ИЗБРАННОЕ';
        container.appendChild(favHeader);
        
        favorites.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    // Render others
    if (others.length > 0) {
        if (favorites.length > 0) {
            let otherHeader = document.createElement('div');
            otherHeader.style.cssText = 'font-size:9px; color:#64748b; font-weight:bold; margin:6px 0 2px 0;';
            otherHeader.innerText = 'ДРУГИЕ СТРАНЫ';
            container.appendChild(otherHeader);
        }
        
        others.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    if (favorites.length === 0 && others.length === 0) {
        let noResults = document.createElement('div');
        noResults.style.cssText = 'text-align:center; padding:8px; color:#64748b; font-size:9px;';
        noResults.innerText = 'Ничего не найдено';
        container.appendChild(noResults);
    }
}

function closeDiplomacyModal() {
    document.getElementById('diplomacyModal').style.display = 'none';
}

function openChatModal() {
    let container = document.getElementById('chatContent');
    container.innerHTML = '<input type="text" id="chatSearch" placeholder="Поиск страны..." oninput="filterChatList()" style="width:100%; font-family:Verdana; font-size:10px; padding:3px; margin-bottom:6px;">';
    
    let contentDiv = document.createElement('div');
    contentDiv.id = 'chatListContent';
    container.appendChild(contentDiv);
    
    filterChatList();
    document.getElementById('chatModal').style.display = 'flex';
}

function filterChatList() {
    let container = document.getElementById('chatListContent');
    container.innerHTML = '';
    
    let searchTerm = document.getElementById('chatSearch').value.toLowerCase();
    
    // Separate favorites and others
    let favorites = [];
    let others = [];
    
    countries.forEach(c => {
        if (c.id === playerCountryId) return;
        
        let matchesSearch = c.name.toLowerCase().includes(searchTerm) || c.id.toLowerCase().includes(searchTerm);
        if (matchesSearch) {
            if (favoriteCountries.has(c.id)) {
                favorites.push(c);
            } else {
                others.push(c);
            }
        }
    });
    
    favorites.sort((a,b)=>a.name.localeCompare(b.name));
    others.sort((a,b)=>a.name.localeCompare(b.name));
    
    const renderCountry = (c) => {
        let messages = chatMessages[c.id] || [];
        let lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        
        let div = document.createElement('div');
        div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc; cursor:pointer;';
        div.onclick = () => openChatWithCountry(c.id);
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${c.name}</strong>
                <span style="font-size:9px; color:#64748b;">${messages.length} сообщ.</span>
            </div>
            ${lastMessage ? `<div style="font-size:9px; color:#64748b; margin-top:2px;">${lastMessage.text.substring(0, 30)}...</div>` : '<div style="font-size:9px; color:#94a3b8; margin-top:2px;">Нет сообщений</div>'}
        `;
        return div;
    };
    
    // Render favorites
    if (favorites.length > 0) {
        let favHeader = document.createElement('div');
        favHeader.style.cssText = 'font-size:9px; color:#f59e0b; font-weight:bold; margin:4px 0 2px 0;';
        favHeader.innerText = 'ИЗБРАННОЕ';
        container.appendChild(favHeader);
        
        favorites.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    // Render others
    if (others.length > 0) {
        if (favorites.length > 0) {
            let otherHeader = document.createElement('div');
            otherHeader.style.cssText = 'font-size:9px; color:#64748b; font-weight:bold; margin:6px 0 2px 0;';
            otherHeader.innerText = 'ДРУГИЕ СТРАНЫ';
            container.appendChild(otherHeader);
        }
        
        others.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    if (favorites.length === 0 && others.length === 0) {
        let noResults = document.createElement('div');
        noResults.style.cssText = 'text-align:center; padding:8px; color:#64748b; font-size:9px;';
        noResults.innerText = 'Ничего не найдено';
        container.appendChild(noResults);
    }
}

function closeChatModal() {
    document.getElementById('chatModal').style.display = 'none';
}

function openChatWithCountry(countryId) {
    let country = countryMap[countryId];
    let messages = chatMessages[countryId] || [];
    
    let container = document.getElementById('chatMessages');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        let isFromPlayer = msg.from === playerCountryId;
        let msgDiv = document.createElement('div');
        msgDiv.style.cssText = `padding:4px; margin-bottom:4px; border-radius:4px; background:${isFromPlayer ? '#dbeafe' : '#f1f5f9'}; max-width:80%; ${isFromPlayer ? 'margin-left:auto;' : ''}`;
        msgDiv.innerHTML = `
            <div style="font-size:9px; color:#64748b;">${isFromPlayer ? 'Вы' : country.name} - ${msg.timestamp.toLocaleDateString()}</div>
            <div style="font-size:10px;">${msg.text}</div>
        `;
        container.appendChild(msgDiv);
    });
    
    document.getElementById('chatCountryName').innerText = country.name;
    document.getElementById('chatTargetCountry').value = countryId;
    document.getElementById('chatConversationModal').style.display = 'flex';
}

function closeChatConversationModal() {
    document.getElementById('chatConversationModal').style.display = 'none';
}

function sendChatFromModal() {
    let targetCountryId = document.getElementById('chatTargetCountry').value;
    let messageText = document.getElementById('chatMessageInput').value;
    
    if (messageText.trim()) {
        sendChatMessage(targetCountryId, messageText);
        document.getElementById('chatMessageInput').value = '';
        openChatWithCountry(targetCountryId); // Refresh chat
    }
}

function openTreatiesModal() {
    let container = document.getElementById('treatiesContent');
    container.innerHTML = '';
    
    if (treaties.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:10px; color:#64748b;">Нет активных договоров</div>';
    } else {
        treaties.forEach(treaty => {
            let div = document.createElement('div');
            div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc;';
            
            const statusColors = {
                'active': '#166534',
                'proposed': '#ca8a04',
                'rejected': '#991b1b'
            };
            
            const statusNames = {
                'active': 'Активен',
                'proposed': 'Предложен',
                'rejected': 'Отклонен'
            };
            
            const partyNames = treaty.parties.map(id => countryMap[id] ? countryMap[id].name : id).join(' ');
            
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${treaty.name}</strong>
                    <span style="color:${statusColors[treaty.status]}; font-size:9px;">${statusNames[treaty.status]}</span>
                </div>
                <div style="font-size:9px; margin-top:2px;">Стороны: ${partyNames}</div>
                <div style="font-size:9px; color:#64748b;">С: ${treaty.startDate.toLocaleDateString()}</div>
            `;
            container.appendChild(div);
        });
    }
    
    document.getElementById('treatiesModal').style.display = 'flex';
}

function closeTreatiesModal() {
    document.getElementById('treatiesModal').style.display = 'none';
}

function openCreateTreatyModal() {
    let sel = document.getElementById('treatyCountrySelect');
    sel.innerHTML = '';
    countries.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
        if (c.id === playerCountryId) return;
        let opt = document.createElement('option');
        opt.value = c.id; opt.innerText = c.name;
        sel.appendChild(opt);
    });
    document.getElementById('createTreatyModal').style.display = 'flex';
}

function closeCreateTreatyModal() {
    document.getElementById('createTreatyModal').style.display = 'none';
}

function createTreatyFromModal() {
    let targetCountryId = document.getElementById('treatyCountrySelect').value;
    let treatyType = document.getElementById('treatyTypeSelect').value;
    
    createTreaty(targetCountryId, treatyType);
    closeCreateTreatyModal();
    openTreatiesModal(); // Refresh treaties list
}

function openNewsModal() {
    let container = document.getElementById('newsContent');
    container.innerHTML = '';
    
    if (newsEvents.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:10px; color:#64748b;">Нет новостей</div>';
    } else {
        newsEvents.forEach(event => {
            let div = document.createElement('div');
            div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc;';
            
            const typeIcons = {
                'world': '',
                'diplomacy': '',
                'economy': '',
                'war': ''
            };
            
            div.innerHTML = `
                <div style="font-size:10px; color:#64748b;">${event.date.toLocaleDateString()} (День ${event.turn})</div>
                <div style="font-size:10px; margin-top:2px;">${typeIcons[event.type] || ''} ${event.text}</div>
            `;
            container.appendChild(div);
        });
    }
    
    document.getElementById('newsModal').style.display = 'flex';
}

function closeNewsModal() {
    document.getElementById('newsModal').style.display = 'none';
}

function openCountryInfoModal() {
    let container = document.getElementById('countryInfoContent');
    container.innerHTML = '<input type="text" id="countryInfoSearch" placeholder="Поиск страны..." oninput="filterCountryInfoList()" style="width:100%; font-family:Verdana; font-size:10px; padding:3px; margin-bottom:6px;">';
    
    let contentDiv = document.createElement('div');
    contentDiv.id = 'countryInfoListContent';
    container.appendChild(contentDiv);
    
    filterCountryInfoList();
    document.getElementById('countryInfoModal').style.display = 'flex';
}

function filterCountryInfoList() {
    let container = document.getElementById('countryInfoListContent');
    container.innerHTML = '';
    
    let searchTerm = document.getElementById('countryInfoSearch').value.toLowerCase();
    
    // Separate favorites and others
    let favorites = [];
    let others = [];
    
    countries.forEach(c => {
        let matchesSearch = c.name.toLowerCase().includes(searchTerm) || c.id.toLowerCase().includes(searchTerm);
        if (matchesSearch) {
            if (favoriteCountries.has(c.id)) {
                favorites.push(c);
            } else {
                others.push(c);
            }
        }
    });
    
    favorites.sort((a,b)=>a.name.localeCompare(b.name));
    others.sort((a,b)=>a.name.localeCompare(b.name));
    
    const renderCountry = (c) => {
        let div = document.createElement('div');
        div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc; cursor:pointer;';
        div.onclick = () => {
            showCountryInfo(c);
            closeCountryInfoModal();
        };
        
        const economy = c.economy || { budget: 0, population: 0, gdp: 0 };
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${c.name} (${c.id})</strong>
                <span style="font-size:9px; color:#64748b;">ВВП: $${economy.gdp.toFixed(1)}B</span>
            </div>
            <div style="font-size:9px; color:#64748b;">Население: ${economy.population.toFixed(1)}M | Бюджет: $${economy.budget.toFixed(1)}M</div>
        `;
        return div;
    };
    
    // Render favorites
    if (favorites.length > 0) {
        let favHeader = document.createElement('div');
        favHeader.style.cssText = 'font-size:9px; color:#f59e0b; font-weight:bold; margin:4px 0 2px 0;';
        favHeader.innerText = 'ИЗБРАННОЕ';
        container.appendChild(favHeader);
        
        favorites.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    // Render others
    if (others.length > 0) {
        if (favorites.length > 0) {
            let otherHeader = document.createElement('div');
            otherHeader.style.cssText = 'font-size:9px; color:#64748b; font-weight:bold; margin:6px 0 2px 0;';
            otherHeader.innerText = 'ДРУГИЕ СТРАНЫ';
            container.appendChild(otherHeader);
        }
        
        others.forEach(c => container.appendChild(renderCountry(c)));
    }
    
    if (favorites.length === 0 && others.length === 0) {
        let noResults = document.createElement('div');
        noResults.style.cssText = 'text-align:center; padding:8px; color:#64748b; font-size:9px;';
        noResults.innerText = 'Ничего не найдено';
        container.appendChild(noResults);
    }
}

function closeCountryInfoModal() {
    document.getElementById('countryInfoModal').style.display = 'none';
}

function openEconomyModal() {
    let player = countryMap[playerCountryId];
    if (!player || !player.economy) return;
    
    let container = document.getElementById('economyContent');
    container.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
            <div class="indicator-box">
                <span class="label">Бюджет:</span>
                <span class="value">$${player.economy.budget.toFixed(2)}M</span>
            </div>
            <div class="indicator-box">
                <span class="label">ВВП:</span>
                <span class="value">$${player.economy.gdp.toFixed(2)}B</span>
            </div>
            <div class="indicator-box">
                <span class="label">Доход/День:</span>
                <span class="value" style="color:#166534;">+$${player.economy.income.toFixed(3)}M</span>
            </div>
            <div class="indicator-box">
                <span class="label">Расходы/День:</span>
                <span class="value" style="color:#991b1b;">-$${player.economy.expenses.toFixed(3)}M</span>
            </div>
            <div class="indicator-box">
                <span class="label">Госдолг:</span>
                <span class="value">$${player.economy.debt.toFixed(2)}M</span>
            </div>
            <div class="indicator-box">
                <span class="label">Кредит. рейтинг:</span>
                <span class="value">${player.economy.creditRating}</span>
            </div>
            <div class="indicator-box">
                <span class="label">Население:</span>
                <span class="value">${player.economy.population.toFixed(1)}M</span>
            </div>
            <div class="indicator-box">
                <span class="label">Рост ВВП:</span>
                <span class="value">${player.economy.growth.toFixed(1)}%</span>
            </div>
        </div>
        <div style="background:#f8fafc; border:1px inset #94a3b8; padding:6px; font-size:9px;">
            <strong>Долг к ВВП:</strong> ${((player.economy.debt / player.economy.gdp) * 100).toFixed(1)}%<br>
            <strong>Инвестиционные очки:</strong> ${player.economy.investmentPoints.toFixed(1)}
        </div>
    `;
    
    document.getElementById('taxRateSlider').value = player.economy.taxRate;
    document.getElementById('taxRateValue').innerText = player.economy.taxRate + '%';
    
    document.getElementById('economyModal').style.display = 'flex';
}

function closeEconomyModal() {
    document.getElementById('economyModal').style.display = 'none';
}

function updateTaxRate(value) {
    let player = countryMap[playerCountryId];
    if (player && player.economy) {
        player.economy.taxRate = parseInt(value);
        document.getElementById('taxRateValue').innerText = value + '%';
        updateCountryEconomics();
        updatePlayerInfo();
        openEconomyModal(); // Refresh modal
    }
}

function openInvestmentModal() {
    let container = document.getElementById('investmentProjectsContent');
    container.innerHTML = '';

    let playerProjects = investmentProjects.filter(p => p.ownerId === playerCountryId).sort((a, b) => b.startTurn - a.startTurn);

    if (playerProjects.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:10px; color:#64748b;">Нет вложений</div>';
    } else {
        playerProjects.forEach(inv => {
            let div = document.createElement('div');
            div.style.cssText = 'border:1px solid #94a3b8; padding:4px; margin-bottom:4px; background:#f8fafc; font-size:9px;';
            let statusText, statusColor;
            if (inv.status === 'active') {
                let daysLeft = Math.max(0, inv.maturityTurn - currentTurn);
                statusText = `в процессе, осталось ${daysLeft} дн.`;
                statusColor = '#0891b2';
            } else if (inv.status === 'matured') {
                statusText = `выплачено $${(inv.amount * (1 + inv.returnPct)).toFixed(2)}M`;
                statusColor = '#166534';
            } else {
                statusText = 'провалилась';
                statusColor = '#dc2626';
            }
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between;"><strong>${inv.name}</strong><span style="color:${statusColor};">${statusText}</span></div>
                <div>Вложено: $${inv.amount.toFixed(2)}M | Ожидаемый доход: +${Math.round(inv.returnPct * 100)}%</div>
            `;
            container.appendChild(div);
        });
    }

    drawInvestmentChart();
    document.getElementById('investmentModal').style.display = 'flex';
}

function closeInvestmentModal() {
    document.getElementById('investmentModal').style.display = 'none';
}

function makeInvestment() {
    let amount = parseFloat(document.getElementById('investmentAmount').value);
    let type = document.getElementById('investmentType').value;
    let cfg = INVESTMENT_TYPES[type];
    let player = countryMap[playerCountryId];
    if (!cfg || !amount || amount <= 0) return;
    if (player.economy.budget < amount) {
        alertBox('Ошибка', 'Недостаточно средств в бюджете!');
        return;
    }
    player.economy.budget -= amount;
    let duration = Math.round(cfg.minDays + RNG() * (cfg.maxDays - cfg.minDays));
    let returnPct = cfg.minReturn + RNG() * (cfg.maxReturn - cfg.minReturn);
    investmentProjects.push({
        id: investmentIdCounter++,
        ownerId: playerCountryId,
        type: type,
        name: cfg.name,
        amount: amount,
        startTurn: currentTurn,
        maturityTurn: currentTurn + duration,
        returnPct: returnPct,
        failChance: cfg.failChance,
        status: 'active'
    });
    addNewsEvent(`${player.name} вкладывает $${amount.toFixed(2)}M в "${cfg.name}" (созреет через ${duration} дн.)`, 'economy');
    updatePlayerInfo();
    openInvestmentModal();
}

function drawInvestmentChart() {
    let canvas = document.getElementById('investmentChart');
    if (!canvas) return;
    let c2 = canvas.getContext('2d');
    c2.clearRect(0, 0, canvas.width, canvas.height);

    let mine = investmentProjects.filter(p => p.ownerId === playerCountryId);
    if (mine.length === 0) {
        c2.fillStyle = '#94a3b8';
        c2.font = '10px Verdana';
        c2.fillText('Нет данных для графика', 10, 55);
        return;
    }

    let minTurn = Math.min(...mine.map(p => p.startTurn));
    let maxTurn = Math.max(...mine.map(p => p.maturityTurn), currentTurn);
    let maxValue = Math.max(...mine.map(p => p.amount * (1 + p.returnPct)), 1);
    let pad = 20;
    let w = canvas.width - pad * 2;
    let h = canvas.height - pad * 2;
    function xOf(t) { return pad + (maxTurn > minTurn ? (t - minTurn) / (maxTurn - minTurn) : 0) * w; }
    function yOf(v) { return pad + h - (maxValue > 0 ? v / maxValue : 0) * h; }

    c2.strokeStyle = '#cbd5e1';
    c2.beginPath();
    c2.moveTo(pad, pad); c2.lineTo(pad, pad + h); c2.lineTo(pad + w, pad + h);
    c2.stroke();

    mine.forEach(inv => {
        let color = inv.status === 'failed' ? '#dc2626' : (inv.status === 'matured' ? '#166534' : '#2563eb');
        let endTurn = Math.min(currentTurn, inv.maturityTurn);
        let progress = Math.min(1, (currentTurn - inv.startTurn) / Math.max(1, inv.maturityTurn - inv.startTurn));
        let endValue = inv.status === 'failed' ? inv.amount * 0.2 : inv.amount + (inv.amount * inv.returnPct) * progress;
        c2.strokeStyle = color;
        c2.lineWidth = 1.5;
        c2.beginPath();
        c2.moveTo(xOf(inv.startTurn), yOf(inv.amount));
        c2.lineTo(xOf(endTurn), yOf(endValue));
        c2.stroke();
        c2.fillStyle = color;
        c2.fillRect(xOf(endTurn) - 1.5, yOf(endValue) - 1.5, 3, 3);
    });
}

function openCreditModal() {
    let sel = document.getElementById('creditLenderSelect');
    sel.innerHTML = '';
    countries.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
        if (c.id === playerCountryId) return;
        let opt = document.createElement('option');
        opt.value = c.id; 
        opt.innerText = `${c.name} (Рейтинг: ${c.economy ? c.economy.creditRating : 'N/A'})`;
        sel.appendChild(opt);
    });
    
    updateCreditsContent();
    document.getElementById('creditModal').style.display = 'flex';
}

function closeCreditModal() {
    document.getElementById('creditModal').style.display = 'none';
}

function updateCreditsContent() {
    let container = document.getElementById('creditsContent');
    container.innerHTML = '';
    
    let playerCredits = credits.filter(c => c.borrower === playerCountryId || c.lender === playerCountryId);
    
    if (playerCredits.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:10px; color:#64748b;">Нет активных кредитов</div>';
    } else {
        playerCredits.forEach(credit => {
            let div = document.createElement('div');
            div.style.cssText = 'border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:#f8fafc; font-size:9px;';
            
            const statusColors = {
                'proposed': '#ca8a04',
                'active': '#166534',
                'paid': '#0891b2',
                'rejected': '#991b1b',
                'defaulted': '#dc2626'
            };
            
            const statusNames = {
                'proposed': 'Предложен',
                'active': 'Активен',
                'paid': 'Погашен',
                'rejected': 'Отклонен',
                'defaulted': 'Дефолт'
            };
            
            let isBorrower = credit.borrower === playerCountryId;
            let otherParty = isBorrower ? credit.lender : credit.borrower;
            
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${isBorrower ? 'Долг перед' : 'Кредит для'} ${countryMap[otherParty].name}</strong>
                    <span style="color:${statusColors[credit.status]}; font-size:9px;">${statusNames[credit.status]}</span>
                </div>
                <div>Сумма: $${credit.amount.toFixed(1)}M | Процент: ${credit.interestRate}%</div>
                <div>Остаток: $${credit.remainingAmount.toFixed(1)}M | Срок: ${credit.duration} дней</div>
                ${credit.status === 'proposed' && isBorrower ? '<button onclick="cancelCreditRequest(' + credit.id + ')" class="btn small red" style="margin-top:4px;">ОТМЕНИТЬ</button>' : ''}
            `;
            container.appendChild(div);
        });
    }
}

function requestCreditFromModal() {
    let lenderId = document.getElementById('creditLenderSelect').value;
    let amount = parseFloat(document.getElementById('creditAmount').value); // Already in millions
    let interestRate = parseFloat(document.getElementById('creditInterest').value);
    let duration = parseInt(document.getElementById('creditDuration').value);
    
    requestCredit(lenderId, amount, interestRate, duration);
    updateCreditsContent();
}

function cancelCreditRequest(creditId) {
    let index = credits.findIndex(c => c.id === creditId);
    if (index !== -1) {
        credits.splice(index, 1);
        updateCreditsContent();
    }
}

function openCustomTreatyModal() {
    // Populate parties selection
    let partiesContainer = document.getElementById('treatyPartiesSelect');
    partiesContainer.innerHTML = '';
    
    countries.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
        if (c.id === playerCountryId) return;
        
        let label = document.createElement('label');
        label.style.cssText = 'display:block; margin-bottom:2px; font-size:9px;';
        label.innerHTML = `
            <input type="checkbox" value="${c.id}" class="treaty-party-checkbox"> ${c.name}
        `;
        partiesContainer.appendChild(label);
    });
    
    // Populate guarantors selection
    let guarantorsContainer = document.getElementById('treatyGuarantorsSelect');
    guarantorsContainer.innerHTML = '';
    
    countries.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
        if (c.id === playerCountryId) return;
        
        let label = document.createElement('label');
        label.style.cssText = 'display:block; margin-bottom:2px; font-size:9px;';
        label.innerHTML = `
            <input type="checkbox" value="${c.id}" class="treaty-guarantor-checkbox"> ${c.name}
        `;
        guarantorsContainer.appendChild(label);
    });
    
    document.getElementById('customTreatyName').value = '';
    document.getElementById('customTreatyContent').value = '';
    
    document.getElementById('customTreatyModal').style.display = 'flex';
}

function closeCustomTreatyModal() {
    document.getElementById('customTreatyModal').style.display = 'none';
}

function submitCustomTreaty() {
    let name = document.getElementById('customTreatyName').value.trim();
    let content = document.getElementById('customTreatyContent').value.trim();
    
    if (!name || !content) {
        alertBox('Ошибка', 'Введите название и содержание договора!');
        return;
    }
    
    let partyCheckboxes = document.querySelectorAll('.treaty-party-checkbox:checked');
    let guarantorCheckboxes = document.querySelectorAll('.treaty-guarantor-checkbox:checked');
    
    let parties = [playerCountryId];
    partyCheckboxes.forEach(cb => parties.push(cb.value));
    
    let guarantors = [];
    guarantorCheckboxes.forEach(cb => guarantors.push(cb.value));
    
    if (parties.length < 2) {
        alertBox('Ошибка', 'Выберите хотя бы одну страну-участника!');
        return;
    }
    
    createCustomTreaty(name, content, parties, guarantors);
    closeCustomTreatyModal();
    openTreatiesModal(); // Refresh treaties list
}

function openNotificationsModal() {
    let container = document.getElementById('notificationsContent');
    container.innerHTML = '';
    
    let playerNotifications = getNotifications(playerCountryId);
    
    if (playerNotifications.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:10px; color:#64748b;">Нет уведомлений</div>';
    } else {
        playerNotifications.forEach(notif => {
            let div = document.createElement('div');
            div.style.cssText = `border:1px solid #94a3b8; padding:6px; margin-bottom:4px; background:${notif.read ? '#f8fafc' : '#dbeafe'}; font-size:9px;`;
            
            let message = '';
            if (notif.type === 'credit_request') {
                let lender = countryMap[notif.from];
                message = `${lender.name} запрашивает кредит $${notif.amount.toFixed(1)}M под ${notif.interestRate}% на ${notif.duration} дней`;
            } else if (notif.type === 'treaty_guarantee_request') {
                let proposer = countryMap[notif.from];
                message = `${proposer.name} просит вас гарантировать выполнение договора "${notif.treatyName}"`;
            } else if (notif.type === 'custom_treaty_proposal') {
                let proposer = countryMap[notif.from];
                message = `${proposer.name} предлагает кастомный договор "${notif.treatyName}"`;
            }
            
            div.innerHTML = `
                <div style="font-size:8px; color:#64748b;">${notif.timestamp.toLocaleDateString()}</div>
                <div style="margin-top:2px;">${message}</div>
                ${!notif.read ? '<div style="color:#0891b2; font-size:8px; margin-top:2px;">● Новое</div>' : ''}
            `;
            container.appendChild(div);
            
            markNotificationRead(playerCountryId, notif.id);
        });
    }
    
    document.getElementById('notificationsModal').style.display = 'flex';
}

function closeNotificationsModal() {
    document.getElementById('notificationsModal').style.display = 'none';
}

// ==================== CONSTRUCTION ====================

function getBuildingsNear(type, ownerId, x, y, radius) {
    return buildings.filter(b => b.type === type && b.ownerId === ownerId && Math.hypot(b.x - x, b.y - y) < radius);
}

function getCostMultiplier(countryId) {
    // Влияние страны реально что-то даёт: чем оно ниже, тем дороже обходится
    // любое строительство и содержание армии.
    let c = countryMap[countryId];
    let influence = c ? c.influence : 70;
    return 1 + Math.max(0, 70 - influence) / 100; // до +70% при влиянии 0
}

function calcBuildingCost(type, x, y, ownerId) {
    const cfg = BUILDING_TYPES[type];
    if (!cfg) return null;
    let sameType = buildings.filter(b => b.type === type && b.ownerId === ownerId);
    let nearby = getBuildingsNear(type, ownerId, x, y, BUILD_CLUSTER_RADIUS);
    if (nearby.length >= BUILD_CLUSTER_HARD_CAP) {
        return { blocked: true, nearby: nearby.length };
    }
    let cost = cfg.baseCost * Math.pow(1.10, sameType.length) * Math.pow(1.5, nearby.length) * getCostMultiplier(ownerId);
    return { cost: Math.round(cost * 100) / 100, nearby: nearby.length, total: sameType.length };
}

function tryPlaceBuilding(type, wPos, targetC) {
    if (!BUILDING_TYPES[type]) return;
    if (!targetC || targetC.id !== playerCountryId) {
        alertBox('Строительство', 'Строить можно только на своей территории.');
        return;
    }
    let player = countryMap[playerCountryId];
    let info = calcBuildingCost(type, wPos.x, wPos.y, playerCountryId);
    if (info.blocked) {
        alertBox('Слишком плотная застройка', `Рядом уже ${info.nearby} объектов типа "${BUILDING_TYPES[type].name}". Здесь строить больше нельзя - выберите место подальше.`);
        return;
    }
    if (player.economy.budget < info.cost) {
        alertBox('Недостаточно средств', `Для строительства нужно $${info.cost.toFixed(2)}M, у вас $${player.economy.budget.toFixed(2)}M.`);
        return;
    }
    player.economy.budget -= info.cost;
    let buildTime = BUILD_TIME_DAYS[type] || 3;
    let b = {
        id: buildingIdCounter++,
        type: type,
        x: wPos.x,
        y: wPos.y,
        ownerId: playerCountryId,
        civRatio: 0.5,
        status: 'building',
        daysLeft: buildTime
    };
    buildings.push(b);
    addNewsEvent(`Начато строительство "${BUILDING_TYPES[type].name}" (стоимость $${info.cost.toFixed(2)}M, готово через ${buildTime} дн.)`, 'economy');
    startConstructionAnimationLoop();
    updatePlayerInfo();
    draw();
    renderConstructionList();
}

function setBuildTool(type) {
    setTool('build_' + type);
    alertBox('Режим строительства', `Выбран объект: "${BUILDING_TYPES[type].name}". Кликните левой кнопкой мыши по своей территории на карте, чтобы построить (кнопка ИНСПЕКЦИЯ в верхней панели отменяет режим строительства).`);
}

function openConstructionModal() {
    renderConstructionList();
    document.getElementById('constructionModal').style.display = 'flex';
}

function closeConstructionModal() {
    document.getElementById('constructionModal').style.display = 'none';
}

function renderConstructionList() {
    let container = document.getElementById('constructionTypesContent');
    if (container) {
        container.innerHTML = '';
        Object.keys(BUILDING_TYPES).forEach(type => {
            let cfg = BUILDING_TYPES[type];
            let sameType = buildings.filter(b => b.type === type && b.ownerId === playerCountryId).length;
            let cost = cfg.baseCost * Math.pow(1.10, sameType) * getCostMultiplier(playerCountryId);
            let row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid #e2e8f0;';
            row.innerHTML = `<span><b style="color:${cfg.color};">&#9632;</b> ${cfg.name} <span style="color:#64748b;">(построено: ${sameType}, от $${cost.toFixed(2)}M)</span></span>`;
            let btn = document.createElement('button');
            btn.className = 'btn small';
            btn.style.width = 'auto';
            btn.innerText = 'СТРОИТЬ';
            btn.onclick = () => { closeConstructionModal(); setBuildTool(type); };
            row.appendChild(btn);
            container.appendChild(row);
        });
    }

    let ownContainer = document.getElementById('constructionOwnedContent');
    if (ownContainer) {
        ownContainer.innerHTML = '';
        let mine = buildings.filter(b => b.ownerId === playerCountryId);
        if (mine.length === 0) {
            ownContainer.innerHTML = '<div style="color:#64748b; padding:6px 0;">У вас пока нет построек на карте.</div>';
        } else {
            mine.forEach(b => {
                let cfg = BUILDING_TYPES[b.type];
                let row = document.createElement('div');
                row.style.cssText = 'padding:4px 0; border-bottom:1px solid #e2e8f0;';
                let statusLabel = b.status === 'building' ? ` <span style="color:#ca8a04;">(строится, ${b.daysLeft} дн.)</span>` : '';
                row.innerHTML = `<div><b style="color:${cfg.color};">&#9632;</b> ${cfg.name} #${b.id}${statusLabel}</div>`;
                ownContainer.appendChild(row);
            });
        }
    }

    let abstractContainer = document.getElementById('abstractBuildingsContent');
    if (abstractContainer) {
        let player = countryMap[playerCountryId];
        let factoryCost = ABSTRACT_TYPES.factory.baseCost * Math.pow(1.15, player.factoryCount || 0) * getCostMultiplier(playerCountryId);
        let housingCost = ABSTRACT_TYPES.housing.baseCost * Math.pow(1.15, player.housingCount || 0) * getCostMultiplier(playerCountryId);
        let factoryQueueLabel = (player.factoryQueue && player.factoryQueue.length > 0) ? ` (строится ещё: ${player.factoryQueue.length})` : '';
        let housingQueueLabel = (player.housingQueue && player.housingQueue.length > 0) ? ` (строится ещё: ${player.housingQueue.length})` : '';
        abstractContainer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid #e2e8f0;">
                <span>Заводы: <b>${player.factoryCount || 0}</b>${factoryQueueLabel} - выпуск: ${(BASE_PARTS_OUTPUT + BASE_CIV_OUTPUT + (player.factoryCount || 0) * ABSTRACT_TYPES.factory.outputPerUnit).toFixed(0)}/день (от $${factoryCost.toFixed(2)}M)</span>
                <button onclick="buyFactory()" class="btn small" style="width:auto;">СТРОИТЬ ЗАВОД</button>
            </div>
            <div style="padding:4px 0; border-bottom:1px solid #e2e8f0;">
                <div>Соотношение гражданское/военное на заводах: <b>${Math.round(player.factoryCivRatio * 100)}%</b> / <b>${Math.round((1 - player.factoryCivRatio) * 100)}%</b></div>
                <input type="range" min="0" max="100" value="${Math.round(player.factoryCivRatio * 100)}" oninput="setFactoryRatio(this.value)" style="width:100%;">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0;">
                <span>Жилые районы: <b>${player.housingCount || 0}</b>${housingQueueLabel} - от $${housingCost.toFixed(2)}M</span>
                <button onclick="buyHousing()" class="btn small" style="width:auto;">СТРОИТЬ РАЙОН</button>
            </div>
        `;
    }
}

function buyFactory() {
    let player = countryMap[playerCountryId];
    let cost = ABSTRACT_TYPES.factory.baseCost * Math.pow(1.15, player.factoryCount || 0) * getCostMultiplier(playerCountryId);
    if (player.economy.budget < cost) {
        alertBox('Недостаточно средств', `Нужно $${cost.toFixed(2)}M, у вас $${player.economy.budget.toFixed(2)}M.`);
        return;
    }
    player.economy.budget -= cost;
    player.factoryQueue = player.factoryQueue || [];
    player.factoryQueue.push({ daysLeft: ABSTRACT_TYPES.factory.buildDays });
    addNewsEvent(`Начато строительство завода ($${cost.toFixed(2)}M, готов через ${ABSTRACT_TYPES.factory.buildDays} дн.)`, 'economy');
    updatePlayerInfo();
    renderConstructionList();
}

function buyHousing() {
    let player = countryMap[playerCountryId];
    let cost = ABSTRACT_TYPES.housing.baseCost * Math.pow(1.15, player.housingCount || 0) * getCostMultiplier(playerCountryId);
    if (player.economy.budget < cost) {
        alertBox('Недостаточно средств', `Нужно $${cost.toFixed(2)}M, у вас $${player.economy.budget.toFixed(2)}M.`);
        return;
    }
    player.economy.budget -= cost;
    player.housingQueue = player.housingQueue || [];
    player.housingQueue.push({ daysLeft: ABSTRACT_TYPES.housing.buildDays });
    addNewsEvent(`Начато строительство жилого района ($${cost.toFixed(2)}M, готов через ${ABSTRACT_TYPES.housing.buildDays} дн.)`, 'economy');
    updatePlayerInfo();
    renderConstructionList();
}

function setFactoryRatio(value) {
    let player = countryMap[playerCountryId];
    player.factoryCivRatio = Math.max(0, Math.min(1, value / 100));
    renderConstructionList();
}

// ==================== ARMY ====================

const PARTS_PER_DIVISION = 40; // военных деталей с заводов, без них дивизию не создать

function calcDivisionCost(ownerId) {
    let country = countryMap[ownerId];
    let n = (country.army ? country.army.divisions.length : 0);
    let money = 0.8 * Math.pow(1.2, n) * getCostMultiplier(ownerId);
    let manpower = 10000; // человек
    let days = 4 + Math.floor(n / 2);
    return { money: Math.round(money * 100) / 100, manpower, parts: PARTS_PER_DIVISION, days };
}

function trainDivision() {
    let player = countryMap[playerCountryId];
    let cost = calcDivisionCost(playerCountryId);
    if ((player.militaryStock || 0) < cost.parts) {
        alertBox('Нет деталей для дивизии', `Нужно ${cost.parts} военных деталей с заводов, у вас ${Math.round(player.militaryStock || 0)}. Постройте завод и направьте часть его производства на военные детали.`);
        return;
    }
    if (player.economy.budget < cost.money) {
        alertBox('Недостаточно средств', `Нужно $${cost.money.toFixed(2)}M, у вас $${player.economy.budget.toFixed(2)}M.`);
        return;
    }
    if (player.economy.manpower < cost.manpower) {
        alertBox('Недостаточно людских ресурсов', `Нужно ${cost.manpower.toLocaleString('ru-RU')} чел., у вас ${Math.round(player.economy.manpower).toLocaleString('ru-RU')}.`);
        return;
    }
    player.economy.budget -= cost.money;
    player.economy.manpower -= cost.manpower;
    player.militaryStock -= cost.parts;
    let hubBonus = buildings.filter(b => b.type === 'military' && b.ownerId === playerCountryId && b.status === 'active').length;
    let days = Math.max(1, cost.days - hubBonus);
    let div = {
        id: player.army.divisions.length + 1,
        name: `${player.name} ${player.army.divisions.length + 1}-я дивизия`,
        strength: 100,
        status: 'training',
        daysLeft: days
    };
    player.army.divisions.push(div);
    addNewsEvent(`Начато формирование "${div.name}" (готовность через ${days} дн.)`, 'war');
    updatePlayerInfo();
    renderArmyContent();
}

function openArmyModal() {
    renderArmyContent();
    document.getElementById('armyModal').style.display = 'flex';
}

function closeArmyModal() {
    document.getElementById('armyModal').style.display = 'none';
}

function renderArmyContent() {
    let player = countryMap[playerCountryId];
    if (!player) return;
    let cost = calcDivisionCost(playerCountryId);
    let hasHub = buildings.some(b => b.type === 'military' && b.ownerId === playerCountryId && b.status === 'active');

    let statsEl = document.getElementById('armyStatsContent');
    if (statsEl) {
        statsEl.innerHTML = `
            <div>Людские ресурсы: <b>${Math.round(player.economy.manpower).toLocaleString('ru-RU')}</b> (+${player.economy.manpowerGrowth.toLocaleString('ru-RU')}/день, макс. ${player.economy.manpowerCap.toLocaleString('ru-RU')})</div>
            <div>Военные детали с заводов: <b>${Math.round(player.militaryStock || 0)}</b> (нужно ${cost.parts} на дивизию)</div>
            <div style="margin-top:6px;">Стоимость новой дивизии: <b>$${cost.money.toFixed(2)}M</b>, <b>${cost.manpower.toLocaleString('ru-RU')}</b> чел., <b>${cost.days}</b> дн.</div>
            ${!hasHub ? '<div style="color:#991b1b; margin-top:4px;">Без военного узла дивизии не смогут дойти до фронта.</div>' : ''}
        `;
    }

    let listEl = document.getElementById('armyDivisionsContent');
    if (listEl) {
        listEl.innerHTML = '';
        if (!player.army || player.army.divisions.length === 0) {
            listEl.innerHTML = '<div style="color:#64748b;">Дивизий пока нет.</div>';
        } else {
            player.army.divisions.forEach(d => {
                let row = document.createElement('div');
                row.style.cssText = 'padding:3px 0; border-bottom:1px solid #e2e8f0;';
                if (d.status === 'training') {
                    row.innerHTML = `<span>${d.name} - обучение (осталось ${d.daysLeft} дн.)</span>`;
                } else {
                    row.innerHTML = `<span>${d.name} - в строю, сила ${Math.round(d.strength)}</span>`;
                }
                listEl.appendChild(row);
            });
        }
    }

    let warTargetsEl = document.getElementById('armyWarTargetsContent');
    if (warTargetsEl) {
        warTargetsEl.innerHTML = '';
        let searchInput = document.getElementById('armyWarTargetSearch');
        let searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        countries.filter(c => c.id !== playerCountryId && c.name.toLowerCase().includes(searchTerm)).forEach(c => {
            let status = getDiplomaticStatus(c.id);
            if (status === 'at_war' || status === 'allied') return;
            let row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:2px 0;';
            row.innerHTML = `<span>${c.name}</span>`;
            let btn = document.createElement('button');
            btn.className = 'btn small red';
            btn.style.width = 'auto';
            btn.innerText = 'ОБЪЯВИТЬ ВОЙНУ';
            btn.onclick = () => declareWar(c.id);
            row.appendChild(btn);
            warTargetsEl.appendChild(row);
        });
    }

    let activeWarsEl = document.getElementById('armyActiveWarsContent');
    if (activeWarsEl) {
        activeWarsEl.innerHTML = '';
        let mine = activeWars.filter(w => w.a === playerCountryId || w.b === playerCountryId);
        if (mine.length === 0) {
            activeWarsEl.innerHTML = '<div style="color:#64748b;">Активных войн нет.</div>';
        } else {
            mine.forEach(w => {
                let enemyId = w.a === playerCountryId ? w.b : w.a;
                let enemy = countryMap[enemyId];
                let myTerr = w.stats ? (w.stats[playerCountryId] || 0) : 0;
                let enemyTerr = w.stats ? (w.stats[enemyId] || 0) : 0;
                let row = document.createElement('div');
                row.style.cssText = 'padding:3px 0; border-bottom:1px solid #e2e8f0;';
                row.innerHTML = `<b>Война с ${enemy ? enemy.name : enemyId}</b><br>Территория (в зоне фронта): вы ${myTerr} / противник ${enemyTerr}
                    <div style="margin-top:3px; display:flex; align-items:center; gap:4px;">
                        <span>Отправить</span>
                        <input type="number" id="sendPercent_${w.id}" value="20" min="1" max="100" style="width:40px; font-size:9px;">
                        <span>% армии на фронт</span>
                    </div>`;
                let btn = document.createElement('button');
                btn.className = 'btn small red';
                btn.style.width = 'auto';
                btn.style.marginTop = '2px';
                btn.innerText = 'ОТПРАВИТЬ';
                btn.onclick = () => {
                    let pctInput = document.getElementById(`sendPercent_${w.id}`);
                    let pct = pctInput ? parseFloat(pctInput.value) : 20;
                    sendReinforcementToFront(w.id, pct);
                };
                row.appendChild(btn);
                activeWarsEl.appendChild(row);
            });
        }
    }
}

// ==================== WAR ====================

function declareWar(targetId) {
    if (targetId === playerCountryId) return;
    let status = getDiplomaticStatus(targetId);
    if (status === 'at_war') return;
    setDiplomaticStatus(targetId, 'at_war');
    startWar(playerCountryId, targetId);
    renderOffscreenMap();
    draw();
    renderArmyContent();
}

function startWar(aId, bId) {
    let aNum = countryMap[aId].numericId;
    let bNum = countryMap[bId].numericId;
    let minX = OFF_W, maxX = 0, minY = OFF_H, maxY = 0;
    for (let y = 0; y < OFF_H; y++) {
        let rowBase = y * OFF_W;
        for (let x = 0; x < OFF_W; x++) {
            let id = territoryOwner[rowBase + x];
            if (id === aNum || id === bNum) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < minX || maxY < minY) return; // one side has no territory at all

    const MARGIN = 50;
    minX = Math.max(0, minX - MARGIN);
    minY = Math.max(0, minY - MARGIN);
    maxX = Math.min(OFF_W - 1, maxX + MARGIN);
    maxY = Math.min(OFF_H - 1, maxY + MARGIN);

    // Снимок границ на момент начала войны - нужен, чтобы потом можно было
    // либо вернуть точно ту же границу (полный вывод войск), либо честно посчитать,
    // какая доля территории была отвоёвана (для частичного присоединения).
    let regionW = maxX - minX + 1;
    let regionH = maxY - minY + 1;
    let originalOwner = new Uint16Array(regionW * regionH);

    for (let y = minY; y <= maxY; y++) {
        let rowBase = y * OFF_W;
        for (let x = minX; x <= maxX; x++) {
            let idx = rowBase + x;
            let id = territoryOwner[idx];
            originalOwner[(y - minY) * regionW + (x - minX)] = id;
            if ((id === aNum || id === bNum) && !warSeeded[idx]) {
                warTroops[idx] = 5 + RNG() * 10;
                warSeeded[idx] = 1;
            }
        }
    }

    activeWars.push({
        id: warIdCounter++,
        a: aId, b: bId,
        bbox: { minX, minY, maxX, maxY },
        originalOwner: originalOwner,
        stats: {}
    });
}

function restoreWarBorders(war) {
    if (!war || !war.originalOwner) return;
    let { minX, minY, maxX, maxY } = war.bbox;
    let regionW = maxX - minX + 1;
    let regionH = maxY - minY + 1;
    for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
            let gi = (minY + y) * OFF_W + (minX + x);
            territoryOwner[gi] = war.originalOwner[y * regionW + x];
            warTroops[gi] = 0;
        }
    }
    renderOffscreenMap();
    draw();
}

function transferEconomyShare(loser, winner, frac) {
    if (!loser || !winner || !loser.economy || !winner.economy || frac <= 0) return;
    let popShare = loser.economy.population * frac;
    let gdpShare = loser.economy.gdp * frac;
    let budgetShare = loser.economy.budget * frac * 0.3;
    let debtShare = (loser.economy.debt || 0) * frac;
    loser.economy.population = Math.max(0.1, loser.economy.population - popShare);
    loser.economy.gdp = Math.max(0.1, loser.economy.gdp - gdpShare);
    loser.economy.budget -= budgetShare;
    loser.economy.debt = Math.max(0, (loser.economy.debt || 0) - debtShare);
    winner.economy.population += popShare;
    winner.economy.gdp += gdpShare;
    winner.economy.budget += budgetShare;
    winner.economy.debt = (winner.economy.debt || 0) + debtShare;
}

function applyProportionalTerritoryTransfer(war) {
    if (!war || !war.originalOwner) return;
    let A = countryMap[war.a], B = countryMap[war.b];
    if (!A || !B) return;
    let aNum = A.numericId, bNum = B.numericId;
    let { minX, minY, maxX, maxY } = war.bbox;
    let regionW = maxX - minX + 1;
    let regionH = maxY - minY + 1;

    let aOriginalCount = 0, aCapturedByB = 0;
    let bOriginalCount = 0, bCapturedByA = 0;
    for (let y = 0; y < regionH; y++) {
        for (let x = 0; x < regionW; x++) {
            let ri = y * regionW + x;
            let orig = war.originalOwner[ri];
            let gi = (minY + y) * OFF_W + (minX + x);
            let cur = territoryOwner[gi];
            if (orig === aNum) {
                aOriginalCount++;
                if (cur === bNum) aCapturedByB++;
            } else if (orig === bNum) {
                bOriginalCount++;
                if (cur === aNum) bCapturedByA++;
            }
        }
    }
    let fracALostToB = aOriginalCount > 0 ? aCapturedByB / aOriginalCount : 0;
    let fracBLostToA = bOriginalCount > 0 ? bCapturedByA / bOriginalCount : 0;
    if (fracALostToB > 0.001) transferEconomyShare(A, B, fracALostToB);
    if (fracBLostToA > 0.001) transferEconomyShare(B, A, fracBLostToA);
}

function computeTotalWarPower(countryId) {
    let c = countryMap[countryId];
    if (!c) return 0;
    // Игроку для переброски дивизий на фронт нужен действующий военный узел -
    // это "центр всего". У ботов нет системы строительства, поэтому для них это не требуется.
    let hasHub = countryId !== playerCountryId || buildings.some(b => b.type === 'military' && b.ownerId === countryId && b.status === 'active');
    let divPower = hasHub && c.army ? c.army.divisions.filter(d => d.status === 'active').reduce((s, d) => s + d.strength, 0) : 0;
    let hubs = buildings.filter(b => b.type === 'military' && b.ownerId === countryId && b.status === 'active').length;
    let milProd = c.militaryStock || 0;
    c.militaryStock = 0; // расходуется за этот ход
    return divPower * 0.02 + hubs * 1.5 + milProd * 0.1;
}

function hasNearbyBuilding(type, ownerId, x, y, radius) {
    return buildings.some(b => b.type === type && b.ownerId === ownerId && b.status === 'active' && Math.hypot(b.x - x, b.y - y) < radius);
}

// ==================== ПЕРЕМЕЩЕНИЕ ВОЙСК (КОНВОИ) ====================
// Войска не появляются на фронте из ниоткуда - они выходят из военного узла
// и какое-то время идут к фронту. Путь виден на карте, чем больше войск - тем ярче точка.

function getHubPosition(countryId) {
    let hub = buildings.find(b => b.type === 'military' && b.ownerId === countryId && b.status === 'active');
    if (!hub) return null;
    return { x: Math.round(hub.x), y: Math.round(hub.y) };
}

function computeLinePath(x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    let path = [];
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;
    let guard = 0;
    while (true) {
        path.push([x, y]);
        if (x === x1 && y === y1) break;
        let e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
        guard++;
        if (guard > 3000) break;
    }
    return path;
}

function spawnConvoy(countryId, targetX, targetY, power, colorSide, warId) {
    let hubPos = getHubPosition(countryId);
    if (!hubPos) return false; // без военного узла перебрасывать некого
    let path = computeLinePath(hubPos.x, hubPos.y, targetX, targetY);
    if (path.length < 2) return false;
    convoys.push({
        id: convoyIdCounter++,
        ownerId: countryId,
        warId: warId,
        path: path,
        pathIndex: 0,
        power: power,
        color: colorSide === 'a' ? '#38bdf8' : '#f87171',
        speed: Math.max(1, Math.round(path.length / 7))
    });
    return true;
}

function processConvoys() {
    for (let i = convoys.length - 1; i >= 0; i--) {
        let cv = convoys[i];
        cv.pathIndex += cv.speed;
        if (cv.pathIndex >= cv.path.length - 1) {
            let [tx, ty] = cv.path[cv.path.length - 1];
            let gi = ty * OFF_W + tx;
            let ownerNum = countryMap[cv.ownerId] ? countryMap[cv.ownerId].numericId : -1;
            if (territoryOwner[gi] === ownerNum) {
                let supplyBonus = hasNearbyBuilding('supply', cv.ownerId, tx, ty, 30) ? 1.4 : 1;
                warTroops[gi] += cv.power * supplyBonus;
            }
            convoys.splice(i, 1);
        }
    }
}

function findWeakestFrontCellForSide(war, countryId) {
    let A = countryMap[countryId];
    let enemyId = war.a === countryId ? war.b : war.a;
    let B = countryMap[enemyId];
    if (!A || !B) return null;
    let myNum = A.numericId, enemyNum = B.numericId;
    let { minX, minY, maxX, maxY } = war.bbox;
    let best = null, bestTroops = Infinity;
    for (let y = minY; y <= maxY; y++) {
        let rowBase = y * OFF_W;
        for (let x = minX; x <= maxX; x++) {
            let gi = rowBase + x;
            if (territoryOwner[gi] !== myNum) continue;
            let isFront = (x > 0 && territoryOwner[gi - 1] === enemyNum) ||
                          (x < OFF_W - 1 && territoryOwner[gi + 1] === enemyNum) ||
                          (y > 0 && territoryOwner[gi - OFF_W] === enemyNum) ||
                          (y < OFF_H - 1 && territoryOwner[gi + OFF_W] === enemyNum);
            if (isFront && warTroops[gi] < bestTroops) { bestTroops = warTroops[gi]; best = { x, y }; }
        }
    }
    return best;
}

function sendReinforcementToFront(warId, percent) {
    let player = countryMap[playerCountryId];
    let war = activeWars.find(w => w.id === warId);
    if (!war || !player.army) return;
    let hubPos = getHubPosition(playerCountryId);
    if (!hubPos) {
        alertBox('Нет военного узла', 'Постройте военный узел - именно оттуда войска идут на фронт.');
        return;
    }
    let totalActive = player.army.divisions.filter(d => d.status === 'active').reduce((s, d) => s + d.strength, 0);
    let amount = totalActive * (percent / 100);
    if (amount < 1) {
        alertBox('Нечего перебрасывать', 'У вас нет достаточно активных дивизий для переброски.');
        return;
    }
    let remaining = amount;
    player.army.divisions.filter(d => d.status === 'active').forEach(d => {
        if (remaining <= 0) return;
        let take = Math.min(d.strength * (percent / 100), remaining);
        d.strength -= take;
        remaining -= take;
    });
    let enemyId = war.a === playerCountryId ? war.b : war.a;
    let target = findWeakestFrontCellForSide(war, playerCountryId);
    if (target) {
        let colorSide = war.a === playerCountryId ? 'a' : 'b';
        spawnConvoy(playerCountryId, target.x, target.y, amount, colorSide, war.id);
        addNewsEvent(`${player.name} перебрасывает ${percent}% армии на фронт против ${countryMap[enemyId].name} - тыл на других направлениях слабеет`, 'war');
    }
    updatePlayerInfo();
    renderArmyContent();
}

function processWars() {
    if (activeWars.length === 0) return;

    // Общая военная мощь страны считается один раз за ход и делится между всеми
    // войнами, в которых она участвует - объявишь слишком много войн сразу,
    // и на каждом фронте останется мало сил.
    let warPowerCache = {};
    let warCountByCountry = {};
    activeWars.forEach(w => {
        warCountByCountry[w.a] = (warCountByCountry[w.a] || 0) + 1;
        warCountByCountry[w.b] = (warCountByCountry[w.b] || 0) + 1;
    });
    function getWarPowerShare(countryId) {
        if (!(countryId in warPowerCache)) {
            warPowerCache[countryId] = computeTotalWarPower(countryId);
        }
        let n = warCountByCountry[countryId] || 1;
        return warPowerCache[countryId] / n;
    }

    for (let wi = activeWars.length - 1; wi >= 0; wi--) {
        let war = activeWars[wi];
        if (!countryMap[war.a] || !countryMap[war.b]) { activeWars.splice(wi, 1); continue; }
        let aNum = countryMap[war.a].numericId;
        let bNum = countryMap[war.b].numericId;
        let minX = war.bbox.minX, minY = war.bbox.minY, maxX = war.bbox.maxX, maxY = war.bbox.maxY;

        let reinforceA = getWarPowerShare(war.a);
        let reinforceB = getWarPowerShare(war.b);

        let regionW = maxX - minX + 1;
        let regionH = maxY - minY + 1;
        let regionOwner = new Uint16Array(regionW * regionH);
        let regionTroops = new Float32Array(regionW * regionH);
        for (let y = 0; y < regionH; y++) {
            for (let x = 0; x < regionW; x++) {
                let gi = (minY + y) * OFF_W + (minX + x);
                regionOwner[y * regionW + x] = territoryOwner[gi];
                regionTroops[y * regionW + x] = warTroops[gi];
            }
        }
        let nextOwner = regionOwner.slice();
        let nextTroops = regionTroops.slice();

        function ownerAt(rx, ry) {
            if (rx < 0 || rx >= regionW || ry < 0 || ry >= regionH) return 0;
            return regionOwner[ry * regionW + rx];
        }

        let aCount = 0, bCount = 0;
        let frontA = [];
        let frontB = [];

        for (let ry = 0; ry < regionH; ry++) {
            for (let rx = 0; rx < regionW; rx++) {
                let id = regionOwner[ry * regionW + rx];
                if (id === aNum) aCount++;
                else if (id === bNum) bCount++;
                else continue;

                let n = [ownerAt(rx - 1, ry), ownerAt(rx + 1, ry), ownerAt(rx, ry - 1), ownerAt(rx, ry + 1)];
                let enemyId = id === aNum ? bNum : aNum;
                if (n.indexOf(enemyId) !== -1) {
                    if (id === aNum) frontA.push([rx, ry]); else frontB.push([rx, ry]);
                }
            }
        }

        war.stats = { [war.a]: aCount, [war.b]: bCount };

        if (aCount <= 50 || bCount <= 50) {
            let loserId = aCount <= 50 ? war.a : war.b;
            let winnerId = aCount <= 50 ? war.b : war.a;
            addNewsEvent(`${countryMap[winnerId].name} побеждает в войне против ${countryMap[loserId].name}!`, 'war');

            // Единая точка окончания войны (человек-победитель диктует условия, бот-победитель решает сам)
            warFinished(loserId, winnerId, war);
            activeWars.splice(wi, 1);
            continue;
        }

        // Небольшое базовое подкрепление на линии (гарнизон держится сам по себе),
        // а основная сила подкрепления идёт колонной от военного узла - см. spawnConvoy ниже
        frontA.forEach(([rx, ry]) => { nextTroops[ry * regionW + rx] += 0.1; });
        frontB.forEach(([rx, ry]) => { nextTroops[ry * regionW + rx] += 0.1; });

        function autoSpawnConvoy(frontCells, amount, ownerId, colorSide) {
            if (frontCells.length === 0 || amount < 1.5) return;
            let weakest = null, weakestTroops = Infinity;
            frontCells.forEach(([rx, ry]) => {
                let t = regionTroops[ry * regionW + rx];
                if (!isHuman(ownerId) && difficulty >= 1) { let foe = colorSide === 'a' ? bNum : aNum, m = 1e9; [[rx-1,ry],[rx+1,ry],[rx,ry-1],[rx,ry+1]].forEach(([nx,ny]) => { if (ownerAt(nx,ny) === foe) m = Math.min(m, regionTroops[ny*regionW+nx]); }); t = m - t * 0.5; }
                if (t < weakestTroops) { weakestTroops = t; weakest = [rx, ry]; }
            });
            if (!weakest) return;
            spawnConvoy(ownerId, minX + weakest[0], minY + weakest[1], amount, colorSide);
        }
        autoSpawnConvoy(frontA, reinforceA, war.a, 'a');
        autoSpawnConvoy(frontB, reinforceB, war.b, 'b');


        function resolveCombat(frontCells, myNum, enemyNum, ownerId, enemyOwnerId) {
            frontCells.forEach(([rx, ry]) => {
                let ri = ry * regionW + rx;
                let myTroops = regionTroops[ri];
                if (myTroops < 8) return;

                let neighborsCoords = [[rx - 1, ry], [rx + 1, ry], [rx, ry - 1], [rx, ry + 1]];
                let enemyNeighbors = neighborsCoords.filter(([nx, ny]) => ownerAt(nx, ny) === enemyNum);
                if (enemyNeighbors.length === 0) return;

                enemyNeighbors.sort((p1, p2) => regionTroops[p1[1] * regionW + p1[0]] - regionTroops[p2[1] * regionW + p2[0]]);
                let tx = enemyNeighbors[0][0], ty = enemyNeighbors[0][1];
                let ti = ty * regionW + tx;

                let defTroops = regionTroops[ti];
                let defenseMult = hasNearbyBuilding('defense', enemyOwnerId, minX + tx, minY + ty, 25) ? 2.0 : 1.0;
                let defPower = defTroops * defenseMult * getCombatMult(enemyOwnerId, ownerId, "def");

                let friendlyFlankers = neighborsCoords.filter(([nx, ny]) => ownerAt(nx, ny) === myNum).length;
                let flankMult = 1.0;
                if (friendlyFlankers === 2) flankMult = 1.3;
                if (friendlyFlankers === 3) flankMult = 1.6;
                if (friendlyFlankers === 4) flankMult = 2.2;
                let attPower = myTroops * flankMult * getCombatMult(ownerId, enemyOwnerId, "att");

                if (attPower > defPower * 1.05) {
                    let defLosses = attPower * 0.14;
                    let attLosses = (defPower / flankMult) * 0.09;
                    nextTroops[ti] = Math.max(0, nextTroops[ti] - defLosses);
                    nextTroops[ri] = Math.max(0, nextTroops[ri] - attLosses);
                    if (nextTroops[ti] <= 0) {
                        nextOwner[ti] = myNum; noteCapture(ownerId, enemyOwnerId, minX + tx, minY + ty);
                        let moved = nextTroops[ri] * 0.6;
                        nextTroops[ti] = moved;
                        nextTroops[ri] -= moved;
                        if (RNG() < 0.15 && (isHuman(ownerId) || isHuman(enemyOwnerId))) {
                            addNewsEvent(`Бой на фронте: ${countryMap[ownerId].name} занимает сектор [${minX + tx},${minY + ty}]`, 'war');
                        }
                    }
                }
            });
        }
        resolveCombat(frontA, aNum, bNum, war.a, war.b);
        resolveCombat(frontB, bNum, aNum, war.b, war.a);

        for (let y = 0; y < regionH; y++) {
            for (let x = 0; x < regionW; x++) {
                let gi = (minY + y) * OFF_W + (minX + x);
                territoryOwner[gi] = nextOwner[y * regionW + x];
                warTroops[gi] = nextTroops[y * regionW + x];
            }
        }
    }

    updateWarOverlay();
}

// ==================== SURRENDER/PEACE TREATY SYSTEM ====================

let currentSurrenderTarget = null;
let currentSurrenderWar = null;

function openSurrenderModal(loserId, war) {
    currentSurrenderTarget = loserId;
    currentSurrenderWar = war || null;
    let loser = countryMap[loserId];
    let winner = countryMap[playerCountryId];
    
    
    let content = document.getElementById('surrenderContent');
    content.innerHTML = `
        <div style="font-weight:bold; margin-bottom:8px; color:#991b1b;">${loser.name} КПИТУЛИРОВАЛА</div>
        <div style="margin-bottom:8px; color:#64748b;">Выберите условия мирного договора. Страна не может отказаться от капитуляции.</div>
        
        <div style="margin-bottom:12px; border:1px solid #94a3b8; padding:8px;">
            <div style="font-weight:bold; margin-bottom:6px;">ВАШИ УСЛОВИЯ:</div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderAnnex" onchange="updateSurrenderPreview()">
                    Полное присоединение территории
                </label>
            </div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderReparations" onchange="updateSurrenderPreview()">
                    Репарации (% от дохода):
                </label>
                <input type="number" id="surrenderReparationsPercent" value="20" min="0" max="100" style="width:50px; font-size:10px;">%
            </div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderArmyLimit" onchange="updateSurrenderPreview()">
                    Ограничить армию (% от текущей):
                </label>
                <input type="number" id="surrenderArmyLimitPercent" value="50" min="0" max="100" style="width:50px; font-size:10px;">%
            </div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderWithdraw" onchange="updateSurrenderPreview()">
                    Полный вывод ваших войск (граница вернётся к довоенной)
                </label>
            </div>
        </div>
        <div style="margin-bottom:8px; color:#64748b; font-size:8px;">Если не выбрано ни полное присоединение, ни вывод войск - вы оставляете себе захваченную территорию, и вам достаётся соответствующая доля населения, ВВП и долга проигравшего.</div>
        
        <div style="margin-bottom:12px; border:1px solid #94a3b8; padding:8px;">
            <div style="font-weight:bold; margin-bottom:6px;">ВАШИ ОБЯЗАТЕЛЬСТВА:</div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderStatus" checked onchange="updateSurrenderPreview()">
                    Прекратить враждебные действия
                </label>
            </div>
            
            <div style="margin-bottom:4px;">
                <label>
                    <input type="checkbox" id="surrenderNAP" onchange="updateSurrenderPreview()">
                    Пакт о ненападении (10 лет)
                </label>
            </div>
        </div>
        
        <div id="surrenderPreview" style="margin-bottom:8px; padding:8px; background:#f8fafc; border:1px solid #94a3b8; font-size:9px;"></div>
        
        <div style="text-align:right;">
            <button onclick="closeSurrenderModal()" class="btn small" style="display:inline-block; width:auto;">ОТМЕНА</button>
            <button onclick="applySurrenderTerms()" class="btn small green" style="display:inline-block; width:auto;">ПРИНЯТЬ УСЛОВИЯ</button>
        </div>
    `;
    
    document.getElementById('surrenderModal').style.display = 'flex';
    updateSurrenderPreview();
}

function closeSurrenderModal() {
    document.getElementById('surrenderModal').style.display = 'none';
    currentSurrenderTarget = null;
    currentSurrenderWar = null;
}

function updateSurrenderPreview() {
    if (!currentSurrenderTarget) return;
    
    let loser = countryMap[currentSurrenderTarget];
    let annex = document.getElementById('surrenderAnnex').checked;
    let reparations = document.getElementById('surrenderReparations').checked;
    let reparationsPercent = document.getElementById('surrenderReparationsPercent').value;
    let armyLimit = document.getElementById('surrenderArmyLimit').checked;
    let armyLimitPercent = document.getElementById('surrenderArmyLimitPercent').value;
    let withdraw = document.getElementById('surrenderWithdraw').checked;
    let status = document.getElementById('surrenderStatus').checked;
    let nap = document.getElementById('surrenderNAP').checked;
    
    let preview = document.getElementById('surrenderPreview');
    let terms = [];
    
    if (annex) {
        terms.push(`ПОЛНОЕ ПРИСОЕДИНЕНИЕ: ${loser.name} исчезнет, территория, население, доход, постройки и армия перейдут к вам`);
    }
    
    if (reparations) {
        let amount = (loser.economy.income * reparationsPercent / 100).toFixed(2);
        terms.push(`РЕПАРАЦИИ: ${loser.name} платит $${amount}M/день (${reparationsPercent}% от дохода)`);
    }
    
    if (armyLimit) {
        let armySize = loser.army ? loser.army.divisions.length : 0;
        let newLimit = Math.round(armySize * armyLimitPercent / 100);
        terms.push(`ОГРАНИЧЕНИЕ АРМИИ: ${loser.name} сократит армию до ${newLimit} дивизий (${armyLimitPercent}% от ${armySize})`);
    }
    
    if (withdraw) {
        terms.push(`ВЫВОД ВОЙСК: Вы полностью выводите войска с территории ${loser.name}`);
    }
    
    if (status) {
        terms.push(`ПРЕКРАЩЕНИЕ ВОЙНЫ: Вы прекращаете враждебные действия`);
    }
    
    if (nap) {
        terms.push(`ПАКТ О НЕНАПАДЕНИИ: Пакт о ненападении на 10 лет`);
    }
    
    preview.innerHTML = terms.length > 0 ? terms.join('<br>') : 'Условия не выбраны';
}

function applySurrenderTerms() {
    if (!currentSurrenderTarget) return;
    const val = id => document.getElementById(id);
    const p = {
        target: currentSurrenderTarget,
        annex: val('surrenderAnnex').checked,
        repar: val('surrenderReparations').checked ? +val('surrenderReparationsPercent').value : 0,
        army: val('surrenderArmyLimit').checked ? +val('surrenderArmyLimitPercent').value : 100,
        withdraw: val('surrenderWithdraw').checked,
        status: val('surrenderStatus').checked,
        nap: val('surrenderNAP').checked
    };
    closeSurrenderModal();
    sendCmd('doSurrender', [p]); // выполняется у всех игроков одновременно (см. peace.js)
}

function annexCountry(sourceId, targetId) {
    let source = countryMap[sourceId];
    let target = countryMap[targetId];
    
    // Передать территорию
    for (let i = 0; i < OFF_W * OFF_H; i++) {
        if (territoryOwner[i] === source.numericId) {
            territoryOwner[i] = target.numericId;
        }
    }
    
    // Передать экономику
    target.economy.budget += source.economy.budget;
    target.economy.population += source.economy.population;
    target.economy.gdp += source.economy.gdp;
    
    // Передать постройки
    buildings.forEach(b => {
        if (b.ownerId === sourceId) {
            b.ownerId = targetId;
        }
    });
    
    // Передать армию
    if (source.army && source.army.divisions) {
        if (!target.army) target.army = { divisions: [] };
        [].forEach(div => {
            div.name = div.name.replace(source.name, target.name);
            target.army.divisions.push(div);
        });
    }
    
    // Удалить страну
    countries = countries.filter(c => c.id !== sourceId);
    delete countryMap[sourceId];
    
    renderOffscreenMap();
    draw();
}

function processBotSurrender(loserId, winnerId) {
    // Бот выбирает случайные условия
    let loser = countryMap[loserId];
    let winner = countryMap[winnerId];
    
    // Простая логика для бота: если у победителя много сил - репарации, иначе просто мир
    if (winner.economy.gdp > loser.economy.gdp * 2) {
        loser.economy.reparations = {
            to: winnerId,
            percent: 0.15 // 15% репараций
        };
        addNewsEvent(`${winner.name} наложила репарации на ${loser.name}`, 'war');
    }
    
    setDiplomaticStatus(loserId, 'neutral');
}

function updateWarOverlay() {
    if (!warOverlayCtx) return;
    warOverlayCtx.clearRect(0, 0, OFF_W, OFF_H);
    activeWars.forEach(war => {
        if (!countryMap[war.a] || !countryMap[war.b]) return;
        let aNum = countryMap[war.a].numericId;
        let bNum = countryMap[war.b].numericId;
        let minX = war.bbox.minX, minY = war.bbox.minY, maxX = war.bbox.maxX, maxY = war.bbox.maxY;
        let w = maxX - minX + 1;
        let h = maxY - minY + 1;
        let imgData = warOverlayCtx.createImageData(w, h);
        let data = imgData.data;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                let gi = y * OFF_W + x;
                let id = territoryOwner[gi];
                if (id !== aNum && id !== bNum) continue;
                let troops = warTroops[gi];
                let p = ((y - minY) * w + (x - minX)) * 4;
                // Своя сторона - синий, вражеская - красный. Тёмный = мало войск,
                // яркий = много войск - разница хорошо видна на любой подложке карты.
                let intensity = Math.min(1, troops / 150);
                if (id === aNum) {
                    data[p] = Math.round(10 + intensity * 60);
                    data[p + 1] = Math.round(25 + intensity * 165);
                    data[p + 2] = Math.round(90 + intensity * 165);
                } else {
                    data[p] = Math.round(90 + intensity * 165);
                    data[p + 1] = Math.round(15 + intensity * 90);
                    data[p + 2] = Math.round(15 + intensity * 40);
                }
                data[p + 3] = 230;
            }
        }
        warOverlayCtx.putImageData(imgData, minX, minY);
    });

    // Колонны подкреплений, идущие от военного узла к фронту - видно, как войска
    // физически перемещаются, а не появляются из ниоткуда
    convoys.forEach(cv => {
        let idx = Math.min(cv.pathIndex, cv.path.length - 1);
        let [cx, cy] = cv.path[idx];
        let r = Math.min(4, 1.2 + cv.power / 25);
        warOverlayCtx.globalAlpha = 0.4;
        warOverlayCtx.fillStyle = cv.color;
        warOverlayCtx.beginPath();
        warOverlayCtx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
        warOverlayCtx.fill();
        warOverlayCtx.globalAlpha = 1;
        warOverlayCtx.beginPath();
        warOverlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
        warOverlayCtx.fill();
    });
}

function alertBox(title, msg) {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = msg;
    document.getElementById('retroAlertModal').style.display = 'flex';
}

function closeAlertBox() {
    document.getElementById('retroAlertModal').style.display = 'none';
}

window.onload = () => {
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    initGrid();
};
