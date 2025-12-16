const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const infoPanel = document.getElementById('info-panel');
const controlModeInput = document.getElementById('control-mode');
const lineLengthInput = document.getElementById('line-length');
const tangentLengthInput = document.getElementById('tangent-length');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const enableSensorsBtn = document.getElementById('enable-sensors');

// --- Global State ---
let animationFrameId = null;
let lastTime = 0;
let isSensorControlActive = false;

// --- Configuration ---
const CONFIG = {
    steps: 100,
    tangentInterval: 10,
    tangentLength: 100,
    stiffness: 80,   // Internal value for auto mode
    damping: 10,     // Internal value for auto mode
    lineLength: 200,        // Pixel value for Desktop
    lineLengthPercent: 0.6, // Percentage for Mobile (0.1 to 0.9)
    controlMode: 'auto' // 'auto' or 'manual'
};

// --- Event Listeners ---
lineLengthInput.addEventListener('input', (e) => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        // Slider value is 10-90, convert to 0.1-0.9
        CONFIG.lineLengthPercent = parseFloat(e.target.value) / 100;
    } else {
        // Slider value is pixels (e.g., 100-1000)
        CONFIG.lineLength = parseFloat(e.target.value);
    }
    resetAndStart();
});

tangentLengthInput.addEventListener('input', (e) => {
    CONFIG.tangentLength = parseFloat(e.target.value);
    if (CONFIG.controlMode === 'manual') {
        draw(); // Redraw static image with new tangent length
    }
});

controlModeInput.addEventListener('change', (e) => {
    CONFIG.controlMode = e.target.value;
    resetAndStart();
});

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// --- Sensor Handling ---
let sensorData = { beta: 0, gamma: 0 };

function handleOrientation(event) {
    if (!isSensorControlActive) return;

    let { beta, gamma } = event;

    // Handle null values
    if (beta === null || gamma === null) return;

    // Clamp values to avoid extreme flipping
    if (beta > 90) beta = 90;
    if (beta < -90) beta = -90;
    if (gamma > 90) gamma = 90;
    if (gamma < -90) gamma = -90;

    sensorData = { beta, gamma };

    // Normalize and scale the input
    // Increase sensitivity: Max movement at 45 degrees tilt
    const sensitivity = 45;

    let tiltX = gamma / sensitivity;
    let tiltY = beta / sensitivity;

    // Clamp to ensure we don't overshoot if user tilts > 45 degrees
    tiltX = Math.max(-1, Math.min(1, tiltX));
    tiltY = Math.max(-1, Math.min(1, tiltY));

    const { width, height } = dimensions;
    const centerX = width / 2;
    const centerY = height / 2;

    // Responsive movement scale
    // X axis uses width (side-to-side)
    const moveScaleX = width * 0.45;
    // Y axis uses height (vertical) - increased to allow much more distortion on tall mobile screens
    const moveScaleY = height * 0.4;

    // Update targets based on tilt
    // P1 moves with tilt
    state.p1.target.x = centerX + tiltX * moveScaleX;
    state.p1.target.y = centerY + tiltY * moveScaleY;

    // P2 mirrors P1
    state.p2.target.x = centerX - tiltX * moveScaleX;
    state.p2.target.y = centerY - tiltY * moveScaleY;
}

function requestSensorAccess() {
    // Check for HTTPS (required for sensors on many devices)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert("Warning: Sensors might not work over HTTP. Please use HTTPS.");
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    // Force Auto mode for physics to work
                    if (CONFIG.controlMode !== 'auto') {
                        CONFIG.controlMode = 'auto';
                        controlModeInput.value = 'auto';
                        resetAndStart();
                    }

                    window.addEventListener('deviceorientation', handleOrientation);
                    isSensorControlActive = true;
                    enableSensorsBtn.style.display = 'none';
                    alert("Sensors enabled! Tilt your device.");
                } else {
                    alert("Permission to access sensors was denied.");
                }
            })
            .catch(error => {
                console.error(error);
                alert("Error requesting sensor permission: " + error.message);
            });
    } else {
        // Android or non-iOS 13+
        try {
            // Check if the device actually supports the event
            if (window.DeviceOrientationEvent) {
                // Force Auto mode for physics to work
                if (CONFIG.controlMode !== 'auto') {
                    CONFIG.controlMode = 'auto';
                    controlModeInput.value = 'auto';
                    resetAndStart();
                }

                window.addEventListener('deviceorientation', handleOrientation);
                isSensorControlActive = true;
                enableSensorsBtn.style.display = 'none';
                alert("Sensors enabled! Tilt your device.");
            } else {
                alert("DeviceOrientationEvent is not supported on this device.");
            }
        } catch (e) {
            alert("Error enabling sensors: " + e.message);
        }
    }
}

// Show sensor button on mobile devices
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
if (isMobile) {
    enableSensorsBtn.style.display = 'block';
    enableSensorsBtn.addEventListener('click', requestSensorAccess);
}

// --- State Objects ---
let dimensions = {
    width: window.innerWidth - 350,
    height: window.innerHeight
};

const state = {
    p0: { x: 0, y: 0 },
    p3: { x: 0, y: 0 },
    p1: null,
    p2: null
};

const mouse = { x: 0, y: 0 };
let isDragging = false;
let draggedPoint = null;

// --- Core Functions ---

function resetAndStart() {
    // Stop any existing animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    lastTime = 0;

    // --- Dynamic Sizing ---
    const isMobile = window.innerWidth <= 768;
    dimensions.width = isMobile ? window.innerWidth : window.innerWidth - 350;
    dimensions.height = window.innerHeight;

    let lineLength;

    if (isMobile) {
        // Mobile: Use percentage
        lineLength = dimensions.width * CONFIG.lineLengthPercent;

        // Update slider UI for percentage (10-90)
        lineLengthInput.min = 10;
        lineLengthInput.max = 90;
        lineLengthInput.value = CONFIG.lineLengthPercent * 100;
    } else {
        // Desktop: Use fixed pixels
        lineLength = CONFIG.lineLength;

        // Update slider UI for pixels (100-1000)
        lineLengthInput.min = 100;
        lineLengthInput.max = 1000;
        lineLengthInput.value = CONFIG.lineLength;
    }

    // Reset canvas and anchor points
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    state.p0 = { x: cx - lineLength / 2, y: cy };
    state.p3 = { x: cx + lineLength / 2, y: cy };

    // Initialize control points based on mode
    if (CONFIG.controlMode === 'auto') {
        state.p1 = new SpringPoint(state.p0.x, state.p0.y - 100, CONFIG.stiffness, CONFIG.damping);
        state.p2 = new SpringPoint(state.p3.x, state.p3.y - 100, CONFIG.stiffness, CONFIG.damping);
    } else { // Manual mode
        // Use simple objects, not SpringPoints
        state.p1 = { pos: { x: state.p0.x + 50, y: state.p0.y - 50 } };
        state.p2 = { pos: { x: state.p3.x - 50, y: state.p3.y + 50 } };
    }

    // Start the appropriate loop/draw
    if (CONFIG.controlMode === 'auto') {
        animationFrameId = requestAnimationFrame(animate);
    } else {
        draw(); // Draw a single static frame for manual mode
    }
}

function init() {
    resetAndStart();
}

// --- Animation Loop (for Auto Mode) ---
function animate(time) {
    // Ensure the loop only runs in auto mode
    if (CONFIG.controlMode !== 'auto') {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        return;
    }

    if (!lastTime) lastTime = time;
    const dt = (time - lastTime) / 1000;
    lastTime = time;
    const safeDt = Math.min(dt, 0.1);

    // Update physics
    state.p1.update(safeDt);
    state.p2.update(safeDt);

    // Render the scene
    draw();

    // Continue the loop
    animationFrameId = requestAnimationFrame(animate);
}

// --- Static Drawing Function (for both modes) ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += 50) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += 50) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();


    const { p0, p1, p2, p3 } = state;

    // Draw Curve
    const gradient = ctx.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
    gradient.addColorStop(0, '#00ffff');
    gradient.addColorStop(0.5, '#ffffff');
    gradient.addColorStop(1, '#00ffff');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);

    const stepSize = 1 / CONFIG.steps;
    for (let i = 0; i <= CONFIG.steps; i++) {
        const t = i * stepSize;
        const pt = BezierMath.getPoint(t, p0, p1.pos, p2.pos, p3);
        ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    // Draw Handles
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#888';

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.pos.x, p1.pos.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p3.x, p3.y);
    ctx.lineTo(p2.pos.x, p2.pos.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw Tangents
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    for (let i = 1; i < CONFIG.steps; i += CONFIG.tangentInterval) {
        const t = i * stepSize;
        const origin = BezierMath.getPoint(t, p0, p1.pos, p2.pos, p3);
        const dir = BezierMath.getTangent(t, p0, p1.pos, p2.pos, p3);

        const start = Vec2.sub(origin, Vec2.scale(dir, CONFIG.tangentLength / 2));
        const end = Vec2.add(origin, Vec2.scale(dir, CONFIG.tangentLength / 2));

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }

    // Draw Control Points
    ctx.fillStyle = '#ff00ff';
    [p1, p2].forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.pos.x, pt.pos.y, 6, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Start and End Points
    ctx.fillStyle = '#ffffff';
    [p0, p3].forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Update Info Panel
    updateInfoPanel();
}

function updateInfoPanel() {
    const { p0, p1, p2, p3 } = state;
    let t = (mouse.x - p0.x) / (p3.x - p0.x);
    t = Math.max(0, Math.min(1, t));

    const pt = BezierMath.getPoint(t, p0, p1.pos, p2.pos, p3);
    const tan = BezierMath.getTangent(t, p0, p1.pos, p2.pos, p3);

    let sensorInfo = '';
    if (isSensorControlActive) {
        sensorInfo = `
        <div class="section">
            <div class="section-title">Sensor Data</div>
            <div class="grid-row">
                <span class="label">Beta (X):</span> <span>${Math.round(sensorData.beta)}°</span>
            </div>
            <div class="grid-row">
                <span class="label">Gamma (Y):</span> <span>${Math.round(sensorData.gamma)}°</span>
            </div>
        </div>`;
    }

    infoPanel.innerHTML = `
        <div class="section">
            <div class="section-title">Control Points</div>
            <div class="grid-row">
                <span class="label">P0:</span> <span>(${Math.round(p0.x)}, ${Math.round(p0.y)})</span>
            </div>
            <div class="grid-row">
                <span class="label">P1:</span> <span>(${Math.round(p1.pos.x)}, ${Math.round(p1.pos.y)})</span>
            </div>
            <div class="grid-row">
                <span class="label">P2:</span> <span>(${Math.round(p2.pos.x)}, ${Math.round(p2.pos.y)})</span>
            </div>
            <div class="grid-row">
                <span class="label">P3:</span> <span>(${Math.round(p3.x)}, ${Math.round(p3.y)})</span>
            </div>
        </div>

        ${sensorInfo}

        <div class="section">
            <div class="cursor-title">Cursor (t ≈ ${t.toFixed(2)})</div>
            <div class="grid-row-cursor">
                <span class="label">Pos:</span> <span>(${Math.round(pt.x)}, ${Math.round(pt.y)})</span>
            </div>
            <div class="grid-row-cursor">
                <span class="label">Tan:</span> <span>(${tan.x.toFixed(2)}, ${tan.y.toFixed(2)})</span>
            </div>
            <div class="grid-row-cursor">
                <span class="label">Angle:</span> <span>${(Math.atan2(tan.y, tan.x) * 180 / Math.PI).toFixed(1)}°</span>
            </div>
        </div>
    `;
}

// --- Event Handlers ---
window.addEventListener('resize', () => {
    // The resetAndStart function will handle the resizing logic
    resetAndStart();
});

canvas.addEventListener('mousedown', (e) => {
    if (CONFIG.controlMode !== 'manual') return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const distP1 = Vec2.mag(Vec2.sub({x, y}, state.p1.pos));
    const distP2 = Vec2.mag(Vec2.sub({x, y}, state.p2.pos));
    const hitRadius = 20;

    if (distP1 < hitRadius) {
        isDragging = true;
        draggedPoint = state.p1;
    } else if (distP2 < hitRadius) {
        isDragging = true;
        draggedPoint = state.p2;
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    draggedPoint = null;
});

// --- Touch Support for Mobile Manual Mode ---
canvas.addEventListener('touchstart', (e) => {
    if (CONFIG.controlMode !== 'manual') return;
    e.preventDefault(); // Prevent scrolling

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const distP1 = Vec2.mag(Vec2.sub({x, y}, state.p1.pos));
    const distP2 = Vec2.mag(Vec2.sub({x, y}, state.p2.pos));
    const hitRadius = 40; // Larger hit area for touch

    if (distP1 < hitRadius) {
        isDragging = true;
        draggedPoint = state.p1;
    } else if (distP2 < hitRadius) {
        isDragging = true;
        draggedPoint = state.p2;
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (CONFIG.controlMode !== 'manual' || !isDragging || !draggedPoint) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    draggedPoint.pos = { x, y };
    draw();
}, { passive: false });

canvas.addEventListener('touchend', () => {
    isDragging = false;
    draggedPoint = null;
});

window.addEventListener('mousemove', (e) => {
    if (isSensorControlActive) return; // Disable mouse control when sensors are active

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    mouse.x = mouseX;
    mouse.y = mouseY;

    if (CONFIG.controlMode === 'auto') {
        // In auto mode, update physics targets with the logic from the React example
        state.p1.target = { x: mouseX, y: mouseY };
        state.p2.target = { x: mouseX + 200, y: dimensions.height - mouseY };
        canvas.style.cursor = 'crosshair';
    } else { // Manual mode
        const distP1 = Vec2.mag(Vec2.sub(mouse, state.p1.pos));
        const distP2 = Vec2.mag(Vec2.sub(mouse, state.p2.pos));

        if (!isDragging) {
            canvas.style.cursor = (distP1 < 20 || distP2 < 20) ? 'grab' : 'default';
        } else {
            canvas.style.cursor = 'grabbing';
        }

        if (isDragging && draggedPoint) {
            draggedPoint.pos = { x: mouseX, y: mouseY };
            draw(); // Redraw static scene on drag
        }
    }
});

// --- Initial Load ---
init();
