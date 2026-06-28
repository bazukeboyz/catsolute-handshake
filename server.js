const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// เก็บค่าน้ำหนักจำนวนตั๋วสะสมปัจจุบันของทั้ง 26 คน (เริ่มต้นที่ 0 ใบ)
let lanes = {}; 

function broadcastLaneUpdate(memberId) {
    if (!lanes[memberId]) return;
    
    io.emit('lane_updated', {
        memberId: memberId,
        data: { 
            status: lanes[memberId].queueStack > 0 ? 'running' : 'idle', 
            tickets: lanes[memberId].queueStack > 0 ? 1 : 0, // ค่าสมมติคิวปัจจุบันเพื่อให้โค้ด Dashboard ทำงานได้
            queueStack: lanes[memberId].queueStack, // ส่งจำนวนตั๋วรวมไปคำนวณนาทีรอคอยโดยตรง
            totalSeconds: 0 
        }
    });
}

io.on('connection', (socket) => {
    // ส่งข้อมูลคิวทั้งหมดให้หน้าจอเมื่อเชื่อมต่อใหม่
    socket.emit('init_all_lanes', lanes);

    // รับสัญญานเพิ่มจำนวนตั๋ว (+1 หรือตามจำนวนที่กรอก)
    socket.on('add_to_stack', (data) => {
        const { memberId, tickets, name } = data;
        const ticketAmount = parseInt(tickets) || 0;

        if (!lanes[memberId]) {
            lanes[memberId] = { name: name, queueStack: 0, status: 'idle' };
        }
        
        lanes[memberId].queueStack += ticketAmount;
        if (lanes[memberId].queueStack < 0) lanes[memberId].queueStack = 0;
        
        broadcastLaneUpdate(memberId);
    });

    // รับสัญญาณหักลบจำนวนตั๋ว (-1 หรือตามจำนวนที่กรอก)
    socket.on('remove_from_stack', (data) => {
        const { memberId, tickets } = data;
        const ticketAmount = parseInt(tickets) || 0;

        if (lanes[memberId]) {
            lanes[memberId].queueStack -= ticketAmount;
            if (lanes[memberId].queueStack <= 0) {
                lanes[memberId].queueStack = 0;
                lanes[memberId].status = 'idle';
            }
            broadcastLaneUpdate(memberId);
        }
    });

    // สั่งอัปเดตยอดตั๋วโดยตรงจากการพิมพ์ตัวเลขลงในช่อง Input
    socket.on('update_input_stack', (data) => {
        const { memberId, tickets, name } = data;
        const ticketAmount = parseInt(tickets) || 0;

        if (!lanes[memberId]) {
            lanes[memberId] = { name: name, queueStack: 0, status: 'idle' };
        }

        lanes[memberId].queueStack = ticketAmount >= 0 ? ticketAmount : 0;
        broadcastLaneUpdate(memberId);
    });

    // ปุ่มล้างคิวของเมมเบอร์คนนั้นๆ ให้กลายเป็น 0 ทันที
    socket.on('reset_queue', (data) => {
        const { memberId } = data;
        if (lanes[memberId]) {
            lanes[memberId].queueStack = 0;
            lanes[memberId].status = 'idle';
            broadcastLaneUpdate(memberId);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`All-in-One Server running on port ${PORT}`); });