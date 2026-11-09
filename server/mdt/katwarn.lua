---@type table MDT access policy.
local access = require 'server.mdt.access'
---@type table Player identity bridge.
local player = require 'bridge.server.player'
---@type table Job bridge.
local job = require 'bridge.server.job'
---@type table Shared validation and rate-limit helpers.
local util = require 'server.util'

local katwarn = {}

local TABLE = 'katwarn_alerts'
local CATEGORIES = {
    police = { label = 'Polizeiwarnung', jobs = { lspd = true, bcso = true } },
    traffic = { label = 'Verkehrswarnung', jobs = { lspd = true, bcso = true } },
    medical = { label = 'Medizinische Warnung', jobs = { lsmc = true } },
}

local function isAdmin(src)
    if GetResourceState('qbx_core') ~= 'started' then return false end
    local ok, allowed = pcall(function()
        return exports.qbx_core:HasPermission(src, 'admin')
    end)
    return ok and allowed == true
end

local function actor(src)
    local admin = isAdmin(src)
    if not admin and not access.can(src, 'katwarn.view') then return nil, false end
    local me = access.identity(src)
    if me then return me, admin end
    if not admin then return nil, false end
    return {
        source = src,
        citizenid = player.getIdentifier(src) or ('source:' .. tostring(src)),
        name = GetPlayerName(src) or 'Administrator',
        job = job.getName(src) or 'admin',
    }, true
end

local function fail(message)
    return { success = false, message = message }
end

local function ok(data)
    return { success = true, data = data }
end

function katwarn.ensureSchema()
    MySQL.query.await(([[
        CREATE TABLE IF NOT EXISTS `%s` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `title` VARCHAR(120) NOT NULL,
            `message` TEXT NOT NULL,
            `category` VARCHAR(20) NOT NULL,
            `location` VARCHAR(160) DEFAULT NULL,
            `issuer_name` VARCHAR(100) NOT NULL,
            `issuer_job` VARCHAR(50) NOT NULL,
            `issuer_citizenid` VARCHAR(64) NOT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `resolved_at` TIMESTAMP NULL DEFAULT NULL,
            `resolved_by` VARCHAR(100) DEFAULT NULL,
            `status` ENUM('active', 'resolved') NOT NULL DEFAULT 'active',
            PRIMARY KEY (`id`),
            KEY `idx_status_created` (`status`, `created_at`),
            KEY `idx_category` (`category`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ]]):format(TABLE))
end

function katwarn.list(src)
    local me, admin = actor(src)
    if not me then return fail('Du hast keinen Zugriff auf KATWarn.') end
    local rows = MySQL.query.await(([[
        SELECT id, title, message, category, location, issuer_name, issuer_job,
               created_at, resolved_at, resolved_by, status
        FROM `%s`
        ORDER BY created_at DESC
        LIMIT 150
    ]]):format(TABLE)) or {}
    return ok({ rows = rows, canCreate = admin or me.job == 'lspd' or me.job == 'bcso' or me.job == 'lsmc',
        isAdmin = admin, job = me.job })
end

function katwarn.create(src, payload)
    local me, admin = actor(src)
    if not me then return fail('Du hast keinen Zugriff auf KATWarn.') end
    local category = type(payload.category) == 'string' and payload.category or ''
    local rule = CATEGORIES[category]
    if not rule then return fail('Ungültige Warnkategorie.') end
    if not admin and not (rule.jobs[me.job] == true) then
        return fail('Deine Dienststelle darf diese Warnkategorie nicht veröffentlichen.')
    end

    if not util.rateLimit(me.citizenid, 'mdt:katwarn:create', 30000, 3) then
        return fail('Bitte warte kurz, bevor du weitere Warnungen veröffentlichst.')
    end

    local title = type(payload.title) == 'string' and payload.title:match('^%s*(.-)%s*$') or ''
    local message = type(payload.message) == 'string' and payload.message:match('^%s*(.-)%s*$') or ''
    local location = type(payload.location) == 'string' and payload.location:match('^%s*(.-)%s*$') or ''
    if #title < 3 or #title > 120 then return fail('Der Titel muss 3 bis 120 Zeichen lang sein.') end
    if #message < 5 or #message > 2000 then return fail('Die Meldung muss 5 bis 2000 Zeichen lang sein.') end
    if #location > 160 then return fail('Der Ort darf maximal 160 Zeichen lang sein.') end

    local id = MySQL.insert.await(([[
        INSERT INTO `%s` (title, message, category, location, issuer_name, issuer_job, issuer_citizenid)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ]]):format(TABLE), { title, message, category, location ~= '' and location or nil,
        me.name, me.job, me.citizenid })
    if not id then return fail('Die Warnung konnte nicht gespeichert werden.') end

    local description = ('%s: %s%s'):format(title, message, location ~= '' and (' | Ort: ' .. location) or '')
    for _, playerId in ipairs(GetPlayers()) do
        TriggerClientEvent('sd-phone:client:mdt:katwarn', tonumber(playerId))
        TriggerClientEvent('ox_lib:notify', tonumber(playerId), {
            title = 'KATWarn · ' .. rule.label,
            description = description,
            type = category == 'medical' and 'inform' or 'warning',
            duration = 12000,
        })
    end

    return ok({ id = id })
end

function katwarn.resolve(src, payload)
    local me, admin = actor(src)
    if not me then return fail('Du hast keinen Zugriff auf KATWarn.') end
    local id = tonumber(payload.id)
    if not id or id < 1 then return fail('Ungültige Warnungs-ID.') end

    local rows = MySQL.query.await(('SELECT issuer_job, status FROM `%s` WHERE id = ? LIMIT 1'):format(TABLE), { id })
    local row = rows and rows[1]
    if not row then return fail('Diese Warnung wurde nicht gefunden.') end
    if row.status ~= 'active' then return fail('Diese Warnung ist bereits erledigt.') end
    if not admin and row.issuer_job ~= me.job then
        return fail('Nur die ausstellende Dienststelle darf diese Warnung auflösen.')
    end

    local changed = MySQL.update.await(([[
        UPDATE `%s` SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
        WHERE id = ? AND status = 'active'
    ]]):format(TABLE), { me.name, id })
    if not changed or changed < 1 then return fail('Die Warnung konnte nicht aufgelöst werden.') end
    for _, playerId in ipairs(GetPlayers()) do
        TriggerClientEvent('sd-phone:client:mdt:katwarn', tonumber(playerId))
    end
    return ok({ id = id })
end

return katwarn
