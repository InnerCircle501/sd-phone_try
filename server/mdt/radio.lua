---@type table MDT access policy.
local access = require 'server.mdt.access'
---@type table Framework job bridge.
local job = require 'bridge.server.job'
---@type table Player bridge.
local player = require 'bridge.server.player'
---@type table MDT config.
local config = require 'configs.config'

local radio = {}
local CHANNEL_MIN, CHANNEL_MAX = 1, 100

local function pmaReady()
    return GetResourceState('pma-voice') == 'started'
end

local function list()
    local channels = {}
    for channel = CHANNEL_MIN, CHANNEL_MAX do
        local ok, occupants = pcall(function()
            return exports['pma-voice']:getPlayersInRadioChannel(channel)
        end)
        local officers = {}
        if ok and type(occupants) == 'table' then
            for sourceId in pairs(occupants) do
                local src = tonumber(sourceId)
                local jobName = src and job.getName(src)
                local dept = jobName and access.departmentFor(jobName)
                if src and dept and dept.type == 'leo' then
                    officers[#officers + 1] = {
                        source = src,
                        name = player.getName(src) or ('ID %s'):format(src),
                        job = jobName,
                        callsign = nil,
                    }
                end
            end
        end
        table.sort(officers, function(x, y) return x.name < y.name end)
        channels[#channels + 1] = { channel = channel, officers = officers }
    end
    return channels
end

radio.list = access.gated('dispatch.radio.view', function(src)
    if not pmaReady() then
        return { success = true, data = { enabled = false, canManage = access.can(src, 'dispatch.radio.manage'), channels = {} } }
    end
    return { success = true, data = { enabled = true, canManage = access.can(src, 'dispatch.radio.manage'), channels = list() } }
end)

radio.move = access.audited('dispatch.radio.manage', function(src, payload, me)
    if not pmaReady() then return { success = false, message = 'pma-voice is not running' } end
    local target = math.floor(tonumber(payload.source) or 0)
    local channel = math.floor(tonumber(payload.channel) or 0)
    if target <= 0 or target == src or channel < CHANNEL_MIN or channel > CHANNEL_MAX then
        return { success = false, message = 'Invalid officer or radio channel' }
    end
    if not GetPlayerName(target) then return { success = false, message = 'Officer is no longer online' } end
    local targetJob = job.getName(target)
    local dept = targetJob and access.departmentFor(targetJob)
    if not dept or dept.type ~= 'leo' then return { success = false, message = 'Target is not an online LEO officer' } end

    local state = Player(target) and Player(target).state
    local from = state and tonumber(state.radioChannel) or 0
    local ok, err = pcall(function()
        exports['pma-voice']:setPlayerRadio(target, channel)
    end)
    if not ok then
        print(('^1[sd-phone:mdt]^0 Radio move failed: %s'):format(err))
        return { success = false, message = 'Could not move officer' }
    end

    local details = ('%s moved %s (ID %d) from channel %d to %d'):format(me.name, player.getName(target) or 'Officer', target, from, channel)
    for _, id in ipairs(GetPlayers()) do
        local recipient = tonumber(id)
        if recipient then TriggerClientEvent('sd-phone:client:mdt:radio', recipient) end
    end
    return { success = true, data = { source = target, channel = channel } }, {
        entityType = 'radio',
        entityId = tostring(target),
        details = details,
    }
end)

return radio
