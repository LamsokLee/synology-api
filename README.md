# Synology API Docker Container

A Docker container for making API calls to your Synology NAS.

## Quick Start

### Option 1: Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the app:**
   Open `http://localhost:3000` in your browser

4. **Enter passwords** in the web form

### Option 2: Using Docker Compose

1. **Build and run:**
   ```bash
   docker-compose up -d
   ```

2. **Access the app:**
   Open `http://localhost:3000` in your browser

3. **Enter passwords** in the web form

### Option 2: Using Docker directly

1. **Build the image:**
   ```bash
   docker build -t synology-api .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     -p 3000:3000 \
     --name synology-api \
     synology-api
   ```

3. **Access the app:**
   Open `http://localhost:3000` in your browser

4. **Enter passwords** in the web form

## Configuration

The Synology URL and account are hardcoded in the backend for simplicity:
- **URL:** `https://192.168.1.2:5001`
- **Account:** `linshuoli`

**Note:** Passwords are entered in the web form for security and are not stored anywhere.

## Usage

1. **Open the web interface** at `http://localhost:3000`
2. **Enter your OTP code**
3. **Click "Run API Calls"**
4. **View the results**

## Docker Commands

```bash
# Build the image
docker build -t synology-api .

# Run the container
docker run -d -p 3000:3000 synology-api

# View logs
docker logs synology-api

# Stop the container
docker stop synology-api

# Remove the container
docker rm synology-api

# Remove the image
docker rmi synology-api
```

## Docker Compose Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

## Security Notes

- **Change default passwords** in production
- **Use environment variables** instead of hardcoded values
- **Consider using secrets** for sensitive data
- **Ensure your NAS is accessible** from the container

## Troubleshooting

- **Check logs:** `docker logs synology-api`
- **Verify environment variables:** `docker exec synology-api env`
- **Test connectivity:** Ensure your NAS is reachable from the container
