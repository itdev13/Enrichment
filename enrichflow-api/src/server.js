require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./utils/logger');
const database = require('./config/database');

/**
 * EnrichFlow API
 * GoHighLevel marketplace app for contact data enrichment.
 */
class EnrichFlowApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3010;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Trust proxy so X-Forwarded-* headers (tunnel / load balancer) are read correctly.
    this.app.set('trust proxy', 1);

    // Allow the app UI to be embedded as an iframe inside GHL.
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'frame-ancestors': [
            "'self'",
            'https://*.gohighlevel.com',
            'https://*.leadconnectorhq.com'
          ]
        }
      }
    }));

    this.app.use(cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // curl / Postman / server-to-server
        const trusted =
          origin.includes('gohighlevel.com') ||
          origin.includes('leadconnectorhq.com') ||
          origin.includes('trycloudflare.com') ||
          origin.includes('ngrok') ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1');
        return trusted ? callback(null, true) : callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    }));

    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Lightweight request logging.
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path === '/health') return;
        logger.info(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        app: 'EnrichFlow',
        db: database.isConnected() ? 'connected' : 'disabled',
        timestamp: new Date().toISOString()
      });
    });

    this.app.use('/oauth', require('./routes/oauth'));
    this.app.use('/api/auth', require('./routes/auth'));
    this.app.use('/api/webhooks', require('./routes/webhooks'));
    this.app.use('/api/enrich', require('./routes/enrich'));
    this.app.use('/api/workflow', require('./routes/workflow'));
    this.app.use('/api/analytics', require('./routes/analytics'));
    this.app.use('/api/contacts', require('./routes/contacts'));
    this.app.use('/api/subscription', require('./routes/subscription'));

    // Serve the built Custom Page UI (if present) at /app so GHL can iframe it same-origin.
    const path = require('path');
    const fs = require('fs');
    const uiDist = path.resolve(__dirname, '../../enrichflow-ui/dist');
    if (fs.existsSync(uiDist)) {
      this.app.use('/app', express.static(uiDist));
      this.app.get('/app/*', (req, res) => res.sendFile(path.join(uiDist, 'index.html')));
      logger.info('   UI:          serving /app from enrichflow-ui/dist');
    }

    this.app.get('/', (req, res) => {
      res.json({
        app: 'EnrichFlow',
        version: require('../package.json').version,
        docs: '/health, /oauth/authorize, /api/enrich'
      });
    });
  }

  setupErrorHandling() {
    this.app.use((req, res) => res.status(404).json({ success: false, error: 'Not Found' }));
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', { message: err.message });
      res.status(err.status || 500).json({ success: false, error: err.message || 'Internal Server Error' });
    });
  }

  async start() {
    await database.connect();
    this.app.listen(this.port, () => {
      logger.info('='.repeat(48));
      logger.info('🚀 EnrichFlow API started');
      logger.info(`   Port:        ${this.port}`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   Base URL:    ${process.env.BASE_URL || `http://localhost:${this.port}`}`);
      logger.info(`   Providers:   ${process.env.ENRICH_PRIMARY || 'mock'} -> ${process.env.ENRICH_FALLBACK || 'mock'}`);
      logger.info('='.repeat(48));
    });
  }
}

new EnrichFlowApp().start();
