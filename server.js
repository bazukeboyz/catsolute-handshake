const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let lanes = {}; 

function broadcastLaneUpdate(memberId) {
    if (!lanes[memberId]) return;

    io.emit('lane_updated', {
        memberId: memberId,
        data: {
            totalSeconds: lanes[memberId].totalSeconds,
            status: lanes[memberId].status,
            queueStack: lanes[memberId].queueStack,
            booth: lanes[memberId].booth || ''
        }
    });
}

io.on('connection', (socket) => {
    let initData = {};
    Object.keys(lanes).forEach(id => {
        initData[id] = lanes[id];
    });
    socket.emit('init_all_lanes', initData);

    // 💡 🌟 สตาฟฟ์กดบวกลบตั๋ว หรือคีย์ยอดใหม่ ระบบจะคำนวณบวก/ลดเวลาทบจากยอดเวลาปัจจุบันทันที
    socket.on('update_input_stack', (data) => {
        const { memberId, tickets, name } = data;
        const targetAmount = parseInt(tickets) || 0;

        if (!lanes[memberId]) {
            lanes[memberId] = { name, totalSeconds: 0, isRunning: false, status: 'idle', queueStack: 0, intervalId: null, booth: '' };
        }

        const oldStack = lanes[memberId].queueStack || 0;
        lanes[memberId].queueStack = targetAmount >= 0 ? targetAmount : 0;
        
        // 💡 ลอจิกหัวใจสำคัญ: คำนวณส่วนต่างจำนวนบัตรที่เปลี่ยนไป
        const diffTickets = lanes[memberId].queueStack - oldStack;

        if (lanes[memberId].isRunning) {
            // 🟢 หากเวลากำลังวิ่งนับถอยหลังอยู่:
            // ให้เอาส่วนต่างตั๋วคูณ 30 วินาที แล้วจับไปบวกทบ (หรือหักลบ) เข้ากับเวลาปัจจุบันที่เหลืออยู่หน้าจอตรงๆ
            lanes[memberId].totalSeconds += (diffTickets * 30);
            
            if (lanes[memberId].totalSeconds <= 0) {
                clearInterval(lanes[memberId].intervalId);
                lanes[memberId].isRunning = false;
                lanes[memberId].status = 'idle';
                lanes[memberId].queueStack = 0;
                lanes[memberId].totalSeconds = 0;
            }
        } else {
            // ⚪ หากเวลายังไม่เริ่มรัน (สถานะ idle / paused): ให้ตั้งเวลารอไว้ตามสูตรปกติ
            lanes[memberId].totalSeconds = lanes[memberId].queueStack * 30;
        }
        
        broadcastLaneUpdate(memberId);
    });

    // ปุ่ม START เริ่มนับถอยหลัง
    socket.on('trigger_manual_start', (data) => {
        const { memberId } = data;
        if (!lanes[memberId] || lanes[memberId].queueStack <= 0 || lanes[memberId].isRunning) return;

        // เริ่มต้นจับเวลารวมจากโควตาตั๋วที่มีอยู่ปัจจุบัน
        lanes[memberId].totalSeconds = lanes[memberId].queueStack * 30;
        lanes[memberId].isRunning = true;
        lanes[memberId].status = 'running';

        if (lanes[memberId].intervalId) clearInterval(lanes[memberId].intervalId);

        lanes[memberId].intervalId = setInterval(() => {
            if (lanes[memberId].totalSeconds > 0) {
                lanes[memberId].totalSeconds--;
                // แปลงวินาทีที่เหลือกลับมาเป็นเม็ดจำนวนตั๋วสะสมบนจอสตาฟฟ์ (30 วินาทีเท่ากับตั๋ว 1 ใบ)
                lanes[memberId].queueStack = Math.ceil(lanes[memberId].totalSeconds / 30);
            } else {
                // เวลาหมดแถว เคลียร์สถานะเลนเป็น 0
                clearInterval(lanes[memberId].intervalId);
                lanes[memberId].isRunning = false;
                lanes[memberId].status = 'timeout';
                lanes[memberId].queueStack = 0;
                lanes[memberId].totalSeconds = 0;
            }
            broadcastLaneUpdate(memberId);
        }, 1000);

        broadcastLaneUpdate(memberId);
    });

    // 📍 สตาฟฟ์เลือกตำแหน่งบูทจาก Dropdown (L1-L4 / C1-C4 / R1-R4)
    socket.on('set_booth', (data) => {
        const { memberId, booth, name } = data;
        if (!lanes[memberId]) {
            lanes[memberId] = { name: name || '', totalSeconds: 0, isRunning: false, status: 'idle', queueStack: 0, intervalId: null, booth: '' };
        }
        lanes[memberId].booth = booth || '';
        broadcastLaneUpdate(memberId);
    });

    // ปุ่ม PAUSE หยุดเวลาชั่วคราว
    socket.on('pause_queue', (data) => {
        const { memberId } = data;
        if (lanes[memberId] && lanes[memberId].isRunning) {
            clearInterval(lanes[memberId].intervalId);
            lanes[memberId].isRunning = false;
            lanes[memberId].status = 'paused';
            broadcastLaneUpdate(memberId);
        }
    });

    // ปุ่ม RESET ล้างเลน (คงตำแหน่งบูทไว้ เพราะเป็นข้อมูลสถานที่ ไม่ใช่ข้อมูลคิว)
    socket.on('reset_queue', (data) => {
        const { memberId } = data;
        let booth = '';
        if (lanes[memberId]) {
            clearInterval(lanes[memberId].intervalId);
            booth = lanes[memberId].booth || '';
            delete lanes[memberId];
        }
        if (booth) {
            lanes[memberId] = { name: '', totalSeconds: 0, isRunning: false, status: 'idle', queueStack: 0, intervalId: null, booth };
        }
        io.emit('lane_reseted', { memberId, booth });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Fix Countdown Server running on port ${PORT}`); });
