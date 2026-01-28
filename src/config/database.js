const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Configure SSL for Neon (required for production)
const sslConfig = process.env.DB_SSL === 'true' || process.env.DB_SSL === true
  ? {
      require: true,
      rejectUnauthorized: false, // Neon uses self-signed certificates
    }
  : false;

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
    dialectOptions: sslConfig ? { ssl: sslConfig } : {},
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

const connectDB = async () => {
  let retries = 5;

  while (retries > 0) {
    try {
      await sequelize.authenticate();
      logger.info('PostgreSQL connection established successfully.');

      // Import models
      const Tenant = require('../models/Tenant');
      const DocumentTemplate = require('../models/DocumentTemplate');
      const DocumentBatch = require('../models/DocumentBatch');
      const DocumentJob = require('../models/DocumentJob');
      const VerificationBatch = require('../models/VerificationBatch');
      const VerificationJob = require('../models/VerificationJob');
      const Client = require('../models/Client');

      // Define associations
      DocumentTemplate.hasMany(DocumentBatch, { foreignKey: 'templateId', as: 'batches' });
      DocumentBatch.belongsTo(DocumentTemplate, { foreignKey: 'templateId', as: 'template' });

      DocumentBatch.hasMany(DocumentJob, { foreignKey: 'batchId', as: 'jobs' });
      DocumentJob.belongsTo(DocumentBatch, { foreignKey: 'batchId', as: 'batch' });

      Client.hasMany(DocumentBatch, { foreignKey: 'clientId', as: 'batches' });
      DocumentBatch.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

      Tenant.hasMany(DocumentBatch, { foreignKey: 'tenantId', as: 'batches' });
      DocumentBatch.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

      // Verification batch and job associations
      VerificationBatch.hasMany(VerificationJob, { foreignKey: 'verificationBatchId', as: 'jobs' });
      VerificationJob.belongsTo(VerificationBatch, { foreignKey: 'verificationBatchId', as: 'batch' });

      // Sync models
      if (process.env.NODE_ENV === 'development') {
        await sequelize.sync({ alter: false });

        // 🟢 Manual Schema Fix (Safe Alternative)
        try {
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT \'{}\'');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "clientId" UUID');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "issuerId" VARCHAR(255)');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMP WITH TIME ZONE');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "invalidationExpiry" TIMESTAMP WITH TIME ZONE');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "issuerPublicKey" TEXT');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "merkleRoot" VARCHAR(255)');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "merkleRootUltimate" VARCHAR(255)');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "merkleProofUltimate" JSONB');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "txHash" VARCHAR(255)');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "network" VARCHAR(50)');
          await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP WITH TIME ZONE');

          try {
            await sequelize.query(`DO $$ BEGIN 
              CREATE TYPE "enum_document_batches_signingStatus" AS ENUM('PendingSigning', 'Signed', 'Finalized');
            EXCEPTION WHEN duplicate_object THEN null; END $$;`);
            await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "signingStatus" "enum_document_batches_signingStatus"');
          } catch (e) {
            await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "signingStatus" VARCHAR(50)');
          }
          await sequelize.query('ALTER TABLE "document_jobs" ADD COLUMN IF NOT EXISTS "recipient_email" VARCHAR(255)');

          // Source Enums
          try {
            await sequelize.query(`DO $$ BEGIN 
              CREATE TYPE "enum_document_batches_source" AS ENUM('user', 'client');
            EXCEPTION WHEN duplicate_object THEN null; END $$;`);
            await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "source" "enum_document_batches_source" DEFAULT \'user\'');
          } catch (e) {
            await sequelize.query('ALTER TABLE "document_batches" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50) DEFAULT \'user\'');
          }

          try {
            await sequelize.query(`DO $$ BEGIN 
              CREATE TYPE "enum_document_jobs_source" AS ENUM('user', 'client');
            EXCEPTION WHEN duplicate_object THEN null; END $$;`);
            await sequelize.query('ALTER TABLE "document_jobs" ADD COLUMN IF NOT EXISTS "source" "enum_document_jobs_source" DEFAULT \'user\'');
          } catch (e) {
            await sequelize.query('ALTER TABLE "document_jobs" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50) DEFAULT \'user\'');
          }

          // 🟢 DocumentTemplate missing columns
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "displayProperty" VARCHAR(255)');
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "qrX" INTEGER DEFAULT 50');
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "qrY" INTEGER DEFAULT 50');
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "qrWidth" INTEGER DEFAULT 100');
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "qrHeight" INTEGER DEFAULT 100');
          await sequelize.query('ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "qrPage" INTEGER DEFAULT 0');
        } catch (schemaErr) {
          logger.warn('Manual schema fix check performed');
        }
      }

      logger.info('Database models initialized and synced successfully.');
      return;
    } catch (error) {
      retries--;
      logger.error(`Unable to connect to the database (${retries} retries left):`, error.message);

      if (retries === 0) {
        logger.error('Failed to connect to database after multiple retries.');
        process.exit(1);
      }

      // Wait 5 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

module.exports = { sequelize, connectDB };
