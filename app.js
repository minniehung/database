const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const mysql = require('mysql');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'minnie',
    password: 'password',
    database: 'ktv2',
    authSwitchHandler: (data, cb) => {
        if (data.pluginName === 'caching_sha2_password') {
            const passwordHash = sha256(data.password + 'your_salt');
            const packet = Buffer.from([0x01, 0x00, 0x00, 0x02, 0x03]);
            cb(null, packet);
        } else {
            cb(new Error('Unknown authentication plugin'));
        }
    }
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL server');
});

// 會員註冊
app.post('/member-register', async (req, res) => {
    const { tel, first_name, last_name, sex, birthday, password } = req.body;

    if (!tel || !first_name || !last_name || !password) {
        console.error('Missing required fields');
        return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    const sql = 'INSERT INTO customer (tel, first_name, last_name, sex, birthday, password) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(sql, [tel, first_name, last_name, sex, birthday, password], (err, result) => {
        if (err) {
            console.error('Database insertion error:', err.message);
            return res.status(500).json({ error: '註冊失敗' });
        }
        console.log('Member registered successfully with ID:', result.insertId);
        res.status(201).json({ message: '註冊成功' });
    });
});

// 會員登入
app.post('/member-login', async (req, res) => {
    const { tel, password } = req.body;

    if (!tel || !password) {
        console.error('Missing required fields');
        return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    const sql = 'SELECT * FROM customer WHERE tel = ? AND password = ?';
    connection.query(sql, [tel, password], (err, result) => {
        if (err) {
            console.error('Database query error:', err.message);
            return res.status(500).json({ error: '登入失敗' });
        }

        if (result.length === 0) {
            console.error('User not found or incorrect password');
            return res.status(400).json({ error: '找不到用戶或密碼錯誤' });
        }

        console.log('Member logged in successfully');
        res.status(200).json({ message: '登入成功', redirectUrl: '/member-option.html' });
    });
});

// 員工登入
app.post('/employee-login', (req, res) => {
    const { id, e_password } = req.body;

    if (!id || !e_password) {
        console.error('Missing required fields');
        return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    const sql = 'SELECT * FROM employee WHERE ID = ?';
    connection.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Database query error:', err.message);
            return res.status(500).json({ error: '登入失敗' });
        }

        if (result.length === 0) {
            console.error('Employee not found');
            return res.status(400).json({ error: '找不到員工' });
        }

        if (result[0].e_password !== e_password) {
            console.error('Incorrect password');
            return res.status(400).json({ error: '密碼錯誤' });
        }

        console.log('Employee logged in successfully');
        res.status(200).json({ message: '登入成功', redirectUrl: '/employee-option.html' });
    });
});

// 音樂搜索功能
app.get('/search', (req, res) => {
    const { songNumber, songName, singer, type } = req.query;

    let query = `
        SELECT ml.song_number, mt.type, ms.song AS songName, mls.singer
        FROM music_library ml
        LEFT JOIN ml_type mt ON ml.song_number = mt.song_number
        LEFT JOIN ml_song ms ON ml.song_number = ms.song_number
        LEFT JOIN ml_singer mls ON ml.song_number = mls.song_number
        WHERE 1=1
    `;
    let params = [];

    if (songNumber) {
        query += ' AND ml.song_number = ?';
        params.push(songNumber);
    }
    if (songName) {
        query += ' AND ms.song = ?';
        params.push(songName);
    }
    if (singer) {
        query += ' AND mls.singer = ?';
        params.push(singer);
    }
    if (type) {
        query += ' AND mt.type = ?';
        params.push(type);
    }

    // 如果 songName 不为空，添加额外条件
    if (songName !== null) {
        query += ' AND ms.song IS NOT NULL';
    }

    // 添加日志查看SQL查询和参数
    console.log('Query:', query);
    console.log('Params:', params);

    connection.query(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed' });
        }
        res.json(rows);
    });
});

// 獲取包廂狀態
app.get('/api/pNumberStatus', (req, res) => {
    const { start, end } = req.query;

    const sql = 'SELECT * FROM box WHERE no BETWEEN ? AND ? ORDER BY no ASC';
    connection.query(sql, [start, end], (err, rows) => {
        if (err) {
            console.error('Error querying database:', err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        if (rows.length === 0) {
            res.status(404).json({ error: 'No boxes found' });
            return;
        }

        res.json(rows);
    });
});

// 更新包廂狀態
app.post('/api/updateBoxStatus', (req, res) => {
    const { no, state } = req.body;

    const sql = 'UPDATE box SET state = ? WHERE no = ?';
    connection.query(sql, [state, no], (err, result) => {
        if (err) {
            console.error('Error updating database:', err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        if (result.affectedRows === 0) {
            res.status(404).json({ error: 'Box not found' });
            return;
        }

        res.json({ success: true });
    });
});

// 提交建議
app.post('/submit-advice', (req, res) => {
    const { advice } = req.body;

    connection.query('SELECT MAX(song_number) AS max_song_number FROM music_library', (err, rows) => {
        if (err) {
            console.error('Database query error:', err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        let newSongNumber = 90000000;
        if (rows.length > 0 && rows[0].max_song_number) {
            newSongNumber = parseInt(rows[0].max_song_number, 10) + 1;
        }

        connection.query('INSERT INTO music_library (advice, song_number) VALUES (?, ?)', [advice, newSongNumber], (err) => {
            if (err) {
                console.error('Error inserting data into database:', err);
                res.status(500).json({ error: 'Internal server error' });
                return;
            }

            console.log('Advice successfully inserted into database. Song number:', newSongNumber);
            res.status(200).send('建議已成功提交');
        });
    });
});

// 獲取評論
app.get('/api/reviews', (req, res) => {
    const sql = 'SELECT * FROM music_library WHERE advice IS NOT NULL';
    connection.query(sql, (err, rows) => {
        if (err) {
            console.error('Database query error:', err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }
        res.json(rows);
    });
});

// 食物查询
app.get('/food', (req, res) => {
    const foodDate = req.query.date;
    if (!foodDate) {
        return res.status(400).send('Date is required');
    }
    const query = 'SELECT c_number, cuisine, food_time FROM food_bar WHERE food_date = ? ORDER BY food_time, c_number';
    connection.query(query, [foodDate], (err, results) => {
        if (err) {
            console.error('Error fetching food data:', err);
            return res.status(500).send('Server error');
        }
        res.json(results);
    });
});


// 啟動服務器
const PORT = process.env.PORT || 3030;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;

