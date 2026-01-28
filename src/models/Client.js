const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Client = sequelize.define(
    'Client',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        clientId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        clientSecret: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        tenantId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        webhookUrl: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        tableName: 'clients',
        timestamps: true,
    }
);

module.exports = Client;
