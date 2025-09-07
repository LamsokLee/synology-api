const express = require('express');
const https = require('https');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration - hardcoded for simplicity
const config = {
    synology: {
        url: "https://linshuoli.myds.me:5001",
        account: "linshuoli"
    }
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// Response logging middleware
app.use((req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
        console.log(`[${new Date().toISOString()}] Response ${res.statusCode}:`, JSON.stringify(JSON.parse(data || '{}'), null, 2));
        originalSend.call(this, data);
    };
    next();
});

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'synology-api.html'));
});

// Create HTTPS agent that ignores SSL certificate errors (like curl -k)
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});


// Encrypt endpoint (login + encrypt)
app.post('/api/encrypt', async (req, res) => {
    console.log('=== ENCRYPT ENDPOINT CALLED ===');
    const { password, otp } = req.body;
    
    console.log('Request parameters:', { password: password ? '***' : 'missing', otp: otp ? '***' : 'missing' });
    
    if (!password || !otp) {
        console.log('ERROR: Missing required parameters');
        return res.status(400).json({ 
            error: 'Password and OTP code are required' 
        });
    }
    
    const { url, account } = config.synology;
    console.log('Using config:', { url, account });
    
    try {
        console.log('Starting combined encrypt operation...');
        
        // Step 1: Login to get SID
        console.log('Step 1: Attempting login...');
        const loginResult = await makeLoginRequest(url, account, password, otp);
        console.log('Login result:', { success: loginResult.success, hasSid: !!loginResult.sid });
        
        if (!loginResult.success) {
            console.log('Login failed:', loginResult);
            return res.json({
                success: false,
                error: 'Login failed: ' + (loginResult.data?.error || 'Unknown error'),
                steps: [{
                    step: 1,
                    name: 'Login',
                    success: false,
                    data: loginResult.data,
                    url: loginResult.url,
                    error: loginResult.data?.error || 'Login failed'
                }]
            });
        }
        
        // Step 2: Encrypt using the SID
        console.log('Step 2: Attempting encrypt with SID:', loginResult.sid);
        const encryptResult = await makeEncryptRequest(url, 'FileVault', loginResult.sid);
        console.log('Encrypt result:', { success: encryptResult.success, data: encryptResult.data });
        
        res.json({
            success: encryptResult.success,
            data: encryptResult.success ? { message: 'FileVault encrypted successfully' } : encryptResult.data,
            steps: [
                {
                    step: 1,
                    name: 'Login',
                    success: true,
                    data: { message: 'Login successful' },
                    url: loginResult.url
                },
                {
                    step: 2,
                    name: 'Encrypt FileVault',
                    success: encryptResult.success,
                    data: encryptResult.success ? { message: 'FileVault encrypted successfully' } : encryptResult.data,
                    url: encryptResult.url,
                    error: encryptResult.success ? null : (encryptResult.data?.error || 'Encrypt failed')
                }
            ]
        });
        
    } catch (error) {
        console.error('Combined encrypt error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// Decrypt endpoint (login + decrypt)
app.post('/api/decrypt', async (req, res) => {
    console.log('=== DECRYPT ENDPOINT CALLED ===');
    const { otp, password, filevaultPassword } = req.body;
    
    console.log('Request parameters:', { 
        password: password ? '***' : 'missing', 
        filevaultPassword: filevaultPassword ? '***' : 'missing', 
        otp: otp ? '***' : 'missing' 
    });
    
    if (!otp || !password || !filevaultPassword) {
        console.log('ERROR: Missing required parameters');
        return res.status(400).json({ 
            error: 'OTP code, password, and FileVault password are required' 
        });
    }
    
    // Use config from backend + passwords from frontend
    const { url, account } = config.synology;
    console.log('Using config:', { url, account });
    
    try {
        console.log('Starting Synology API calls...');
        
        // Step 1: Login
        console.log('Step 1: Attempting login...');
        const loginResult = await makeLoginRequest(url, account, password, otp);
        console.log('Login result:', { success: loginResult.success, hasSid: !!loginResult.sid });
        
        if (!loginResult.success) {
            console.log('Login failed:', loginResult);
            return res.json({
                success: false,
                steps: [
                    {
                        step: 1,
                        name: 'Login',
                        success: false,
                        data: loginResult.data,
                        url: loginResult.url,
                        error: loginResult.error
                    }
                ]
            });
        }
        
        const sid = loginResult.sid;
        console.log('Login successful, SID:', sid);
        
        // Step 2: Decrypt FileVault
        console.log('Step 2: Attempting decrypt with SID:', sid);
        const decryptResult = await makeDecryptRequest(url, filevaultPassword, sid);
        console.log('Decrypt result:', { success: decryptResult.success, data: decryptResult.data });
        
        res.json({
            success: loginResult.success && decryptResult.success,
            steps: [
                {
                    step: 1,
                    name: 'Login',
                    success: loginResult.success,
                    data: loginResult.success ? { message: 'Login successful' } : loginResult.data,
                    url: loginResult.url,
                    sid: sid,
                    error: loginResult.success ? null : (loginResult.data.error || 'Login failed')
                },
                {
                    step: 2,
                    name: 'Decrypt FileVault',
                    success: decryptResult.success,
                    data: decryptResult.success ? { message: 'FileVault decrypted successfully' } : decryptResult.data,
                    url: decryptResult.url,
                    error: decryptResult.success ? null : (decryptResult.data.error || 'Decrypt failed')
                }
            ]
        });
        
    } catch (error) {
        console.error('Combined API error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to make HTTPS GET requests
function makeHttpsRequest(url) {
    console.log('=== makeHttpsRequest called ===');
    console.log('Requesting URL:', url);
    
    return new Promise((resolve, reject) => {
        const request = https.get(url, { agent: httpsAgent }, (response) => {
            console.log('HTTPS Response received:', { statusCode: response.statusCode, headers: response.headers });
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                console.log('Raw response data:', data);
                try {
                    const jsonData = JSON.parse(data);
                    console.log('Parsed JSON data:', jsonData);
                    resolve({
                        success: response.statusCode === 200 && jsonData.success,
                        data: jsonData,
                        status: response.statusCode
                    });
                } catch (error) {
                    console.log('JSON parse error:', error.message);
                    resolve({
                        success: false,
                        data: { error: 'Invalid JSON response', raw: data },
                        status: response.statusCode
                    });
                }
            });
        });
        
        request.on('error', (error) => {
            console.log('HTTPS request error:', error);
            reject(error);
        });
        
        request.setTimeout(10000, () => {
            console.log('Request timeout after 10 seconds');
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Helper function to make HTTPS POST requests
function makeHttpsPostRequest(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data)
            },
            agent: httpsAgent
        };
        
        const request = https.request(options, (response) => {
            let responseData = '';
            
            response.on('data', (chunk) => {
                responseData += chunk;
            });
            
            response.on('end', () => {
                try {
                    const jsonData = JSON.parse(responseData);
                    resolve({
                        success: response.statusCode === 200 && jsonData.success,
                        data: jsonData,
                        status: response.statusCode
                    });
                } catch (error) {
                    resolve({
                        success: false,
                        data: { error: 'Invalid JSON response', raw: responseData },
                        status: response.statusCode
                    });
                }
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.write(data);
        request.end();
        
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Helper function for login request
async function makeLoginRequest(url, account, password, otp) {
    console.log('=== makeLoginRequest called ===');
    console.log('URL:', url);
    console.log('Account:', account);
    console.log('Password:', password ? '***' : 'missing');
    console.log('OTP:', otp ? '***' : 'missing');
    
    const loginUrl = `${url}/webapi/auth.cgi`;
    const params = new URLSearchParams({
        'api': 'SYNO.API.Auth',
        'version': '6',
        'method': 'login',
        'account': account,
        'passwd': password,
        'otp_code': otp,
        'session': 'FileStation',
        'format': 'sid'
    });
    
    const fullUrl = `${loginUrl}?${params.toString()}`;
    console.log('Full login URL:', fullUrl);
    
    const result = await makeHttpsRequest(fullUrl);
    console.log('Login response:', { success: result.success, status: result.status, hasData: !!result.data });
    
    if (result.success) {
        result.sid = result.data.data?.sid;
        console.log('Extracted SID:', result.sid ? '***' : 'none');
    } else {
        console.log('Login failed:', result.data);
    }
    
    result.url = fullUrl;
    return result;
}

// Helper function for decrypt request
async function makeDecryptRequest(url, filevaultPassword, sid) {
    console.log('=== makeDecryptRequest called ===');
    console.log('URL:', url);
    console.log('FileVault Password:', filevaultPassword ? '***' : 'missing');
    console.log('SID:', sid ? '***' : 'missing');
    
    const decryptUrl = `${url}/webapi/entry.cgi`;
    const formData = new URLSearchParams({
        'api': 'SYNO.Core.Share.Crypto',
        'version': '1',
        'method': 'decrypt',
        'name': 'FileVault',
        'password': filevaultPassword,
        '_sid': sid
    });
    
    console.log('Decrypt URL:', decryptUrl);
    console.log('Form data:', formData.toString());
    
    const result = await makeHttpsPostRequest(decryptUrl, formData.toString());
    console.log('Decrypt response:', { success: result.success, status: result.status, hasData: !!result.data });
    
    result.url = decryptUrl;
    return result;
}

// Helper function for encrypt request
async function makeEncryptRequest(url, name, sid) {
    console.log('=== makeEncryptRequest called ===');
    console.log('URL:', url);
    console.log('Name:', name);
    console.log('SID:', sid ? '***' : 'missing');
    
    const encryptUrl = `${url}/webapi/entry.cgi`;
    const formData = new URLSearchParams({
        'api': 'SYNO.Core.Share.Crypto',
        'version': '1',
        'method': 'encrypt',
        'name': name,
        '_sid': sid
    });
    
    console.log('Encrypt URL:', encryptUrl);
    console.log('Form data:', formData.toString());
    
    const result = await makeHttpsPostRequest(encryptUrl, formData.toString());
    console.log('Encrypt response:', { success: result.success, status: result.status, hasData: !!result.data });
    
    result.url = encryptUrl;
    return result;
}

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'synology-api.html'));
});

app.listen(PORT, () => {
    console.log(`Synology API Backend running on port ${PORT}`);
    console.log(`Access the app at: http://localhost:${PORT}`);
});
