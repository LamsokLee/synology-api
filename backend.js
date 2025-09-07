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

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'synology-api.html'));
});

// Create HTTPS agent that ignores SSL certificate errors (like curl -k)
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { password, otp } = req.body;
    
    if (!password || !otp) {
        return res.status(400).json({ error: 'Missing required parameters: password and otp' });
    }
    
    // Use hardcoded config
    const { url, account } = config.synology;
    
    try {
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
        console.log('Making login request to:', fullUrl);
        
        const response = await makeHttpsRequest(fullUrl);
        
        if (response.success) {
            const sid = response.data.data?.sid;
            if (!sid) {
                return res.status(400).json({ 
                    error: 'No SID received from login response',
                    response: response.data 
                });
            }
            
            res.json({
                success: true,
                data: response.data,
                sid: sid,
                url: fullUrl
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Login failed',
                data: response.data,
                url: fullUrl
            });
        }
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Decrypt FileVault endpoint
app.post('/api/decrypt', async (req, res) => {
    const { url, filevaultPassword, sid } = req.body;
    
    if (!url || !filevaultPassword || !sid) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    try {
        const decryptUrl = `${url}/webapi/entry.cgi`;
        const formData = new URLSearchParams({
            'api': 'SYNO.Core.Share.Crypto',
            'version': '1',
            'method': 'decrypt',
            'name': 'FileVault',
            'password': filevaultPassword,
            '_sid': sid
        });
        
        console.log('Making decrypt request to:', decryptUrl);
        
        const response = await makeHttpsPostRequest(decryptUrl, formData.toString());
        
        res.json({
            success: response.success,
            data: response.data,
            url: decryptUrl
        });
        
    } catch (error) {
        console.error('Decrypt error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get configuration endpoint
app.get('/api/config', (req, res) => {
    res.json({
        url: config.synology.url,
        account: config.synology.account,
        // Passwords are provided by frontend
        requiresPasswords: true
    });
});

// Combined encrypt endpoint (login + encrypt)
app.post('/api/synology-encrypt', async (req, res) => {
    const { password, otp } = req.body;
    
    if (!password || !otp) {
        return res.status(400).json({ 
            error: 'Password and OTP code are required' 
        });
    }
    
    const { url, account } = config.synology;
    
    try {
        console.log('Starting combined encrypt operation...');
        
        // Step 1: Login to get SID
        const loginResult = await makeLoginRequest(url, account, password, otp);
        
        if (!loginResult.success) {
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
        const encryptResult = await makeEncryptRequest(url, 'FileVault', loginResult.sid);
        
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Individual encrypt endpoint (for backward compatibility)
app.post('/api/encrypt', async (req, res) => {
    const { name, sid } = req.body;
    
    if (!name || !sid) {
        return res.status(400).json({ 
            error: 'Name and SID are required' 
        });
    }
    
    const { url } = config.synology;
    
    try {
        console.log('Starting encrypt operation...');
        
        const encryptResult = await makeEncryptRequest(url, name, sid);
        
        res.json({
            success: encryptResult.success,
            data: encryptResult.success ? { message: 'Encrypt successful' } : encryptResult.data,
            url: encryptResult.url,
            error: encryptResult.success ? null : (encryptResult.data.error || 'Encrypt failed')
        });
        
    } catch (error) {
        console.error('Encrypt error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Combined endpoint that does both login and decrypt
app.post('/api/synology-calls', async (req, res) => {
    const { otp, password, filevaultPassword } = req.body;
    
    if (!otp || !password || !filevaultPassword) {
        return res.status(400).json({ 
            error: 'OTP code, password, and FileVault password are required' 
        });
    }
    
    // Use config from backend + passwords from frontend
    const { url, account } = config.synology;
    
    try {
        console.log('Starting Synology API calls...');
        
        // Step 1: Login
        const loginResult = await makeLoginRequest(url, account, password, otp);
        
        if (!loginResult.success) {
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
        const decryptResult = await makeDecryptRequest(url, filevaultPassword, sid);
        
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to make HTTPS GET requests
function makeHttpsRequest(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { agent: httpsAgent }, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        success: response.statusCode === 200 && jsonData.success,
                        data: jsonData,
                        status: response.statusCode
                    });
                } catch (error) {
                    resolve({
                        success: false,
                        data: { error: 'Invalid JSON response', raw: data },
                        status: response.statusCode
                    });
                }
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(10000, () => {
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
    const result = await makeHttpsRequest(fullUrl);
    
    if (result.success) {
        result.sid = result.data.data?.sid;
    }
    
    result.url = fullUrl;
    return result;
}

// Helper function for decrypt request
async function makeDecryptRequest(url, filevaultPassword, sid) {
    const decryptUrl = `${url}/webapi/entry.cgi`;
    const formData = new URLSearchParams({
        'api': 'SYNO.Core.Share.Crypto',
        'version': '1',
        'method': 'decrypt',
        'name': 'FileVault',
        'password': filevaultPassword,
        '_sid': sid
    });
    
    const result = await makeHttpsPostRequest(decryptUrl, formData.toString());
    result.url = decryptUrl;
    return result;
}

// Helper function for encrypt request
async function makeEncryptRequest(url, name, sid) {
    const encryptUrl = `${url}/webapi/entry.cgi`;
    const formData = new URLSearchParams({
        'api': 'SYNO.Core.Share.Crypto',
        'version': '1',
        'method': 'encrypt',
        'name': name,
        '_sid': sid
    });
    
    const result = await makeHttpsPostRequest(encryptUrl, formData.toString());
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
    console.log('This backend handles SSL certificate issues (like curl -k)');
});
