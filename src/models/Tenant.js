const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Tenant = sequelize.define(
  'Tenant',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    domain: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      validate: {
        isLowercase: true,
      },
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Public Key (Hex/PEM) stored directly in DB for verification',
    },
  },
  {
    tableName: 'tenants',
    timestamps: true,
    indexes: [
      {
        fields: ['isActive'],
      },
    ],
  }
);

module.exports = Tenant;
