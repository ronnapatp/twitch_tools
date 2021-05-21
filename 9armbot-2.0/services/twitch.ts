import axios from 'axios'
import tmi from 'tmi.js'
import commands, { isError } from './bot'
import Player from './models/player'
import { devMode } from '../config'
import Widget from './widget'
import Setting from './setting'
import { Db } from './db'
import prisma from '../../prisma/client'

const widget = new Widget(false)
const db = new Db()

const silentBotMode = ['1', 'true'].includes(
  process.env.SILENT_BOT_MODE as string,
)

async function getTwitchChatters() {
  const url = `${process.env.twitch_api}/group/user/${process.env.tmi_channel_name}/chatters`
  const { data } = await axios.get(url)

  return {
    viewers: data.chatters.viewers as string[],
    mods: data.chatters.moderators as string[],
    vips: data.chatters.vips as string[],
  }
}

async function botSay(client: tmi.Client, channel: string, message: string) {
  if (silentBotMode) {
    console.log(`[Silent Mode] ${client.getUsername()}: ${message}`)
  } else {
    return await client.say.apply(client, [channel, message])
  }
}

async function payday(amount: number = 1, subscriber: string) {
  const chatters = await getTwitchChatters()
  const players = [...chatters.vips, ...chatters.viewers, ...chatters.mods]
  await commands.giveCoinToList(players, amount)

  widget.feed(
    `<i class="fas fa-gift"></i> สมาชิก <b class="badge bg-info">${players.length}</b> คนได้รับ 1 ArmCoin <i class="fas fa-coins"></i> จากการ Subscribe ของ <b class="badge bg-primary">${subscriber}</b>`,
  )

  return {
    playersPaidCount: players.length,
  }
}

export async function subscriptionPayout(username: string) {
  let player = await Player.withUsername(username)
  await player.giveCoin(10)

  widget.feed(
    `<b class="badge bg-primary">${username}</b> ได้รับ <i class="fas fa-coins"></i> 10 ArmCoin จากการ Subscribe`,
  )

  return await payday(1, username)
}

export async function twitchService() {
  const setting = await Setting.init()

  const client = new tmi.Client({
    options: {
      debug: devMode,
    },
    connection: { reconnect: true },
    identity: {
      username: process.env.tmi_username,
      password: process.env.BOTV2_TWITCH_OAUTH_TOKEN,
    },
    channels: [process.env.tmi_channel_name as string],
  })

  client.on('connected', () => {
    console.log('Connected to Twitch')
  })

  await client.connect()

  // Cache existing player names from db
  const existingPlayerNames = new Set(
    (await prisma.player.findMany({ select: { username: true } })).map(
      (p) => p.username,
    ),
  )

  client.on('join', async (_channel, username, _self) => {
    // Ensure new players are created on join
    if (!existingPlayerNames.has(username.toLowerCase())) {
      existingPlayerNames.add(username.toLowerCase())
      await db.createPlayer(username)
    }
  })

  client.on('part', (_channel, username, _self) => {
    console.log(`${username} left...`)
  })

  client.on('message', async (channel, tags, message, self) => {
    if (self) return

    const username = tags!.username!

    // Ensure new players are created on message
    if (username && !existingPlayerNames.has(username.toLowerCase())) {
      existingPlayerNames.add(username.toLowerCase())
      await db.createPlayer(username)
    }

    if (message[0] !== '!') return

    const [cmdName, ...cmdArgs] = message.split(/\s+/)

    let result, amount

    // ! Commands
    switch (cmdName) {
      case '!github':
        botSay(client, channel, 'https://github.com/thananon/twitch_tools')
        break
      case '!fetch':
        // test cmd; precursor to give coin to everyone.
        console.log(getTwitchChatters())
        break
      case '!allin':
        // TODO: random win
        result = await commands.allin(username)

        if (isError(result)) {
          if (result.error == 'not_enough_coin') {
            await botSay(client, channel, `@${username} มี ArmCoin ไม่พอ!.`)
          }
          return
        }

        if (result.data.state == 'win_jackpot') {
          await botSay(
            client,
            channel,
            `ALL-IN JACKPOT!! @${username} ลงหมดหน้าตัก ${result.data.bet} -> ได้รางวัล ${result.data.win} ArmCoin (${result.data.balance}).`,
          )

          widget.feed(
            `<b class="badge bg-primary">${username}</b> <i class="fas fa-coins"></i> ALL-IN JACKPOT!!! <i class="fas fa-level-up-alt"></i> +${result.data.win} ArmCoin (${result.data.balance})`,
          )
        } else if (result.data.state == 'win') {
          await botSay(
            client,
            channel,
            `@${username} ลงหมดหน้าตัก ${result.data.bet} -> ได้รางวัล ${result.data.win} ArmCoin`,
          )

          widget.feed(
            `<b class="badge bg-primary">${username}</b> <i class="fas fa-hand-holding-usd"></i> <i class="fas fa-level-up-alt"></i> +${result.data.win} ArmCoin`,
          )
        } else if (result.data.state == 'lose') {
          await botSay(
            client,
            channel,
            `@${username} ลงหมดหน้าตัก ${result.data.bet} -> แตก!`,
          )

          widget.feed(
            `<b class="badge bg-danger">${username}</b> <i class="fas fa-user-injured"></i> <i class="fas fa-level-down-alt"></i> -${result.data.bet} ArmCoin`,
          )
        }
        break
      case '!auction':
        console.log('TODO')
        break
      case '!botstat':
        console.log('TODO')
        break
      case '!coin':
        result = await commands.coin(username)

        if (isError(result)) {
          await botSay(client, channel, `@${username} มี 0 ArmCoin.`)
          return
        }

        await botSay(client, channel, `@${username} มี ${result.data} ArmCoin.`)
        break
      case '!draw':
        console.log('TODO')
        break
      case '!gacha':
        if (cmdArgs.length) {
          let group = cmdArgs[0].match(/(-?\d+)/)
          if (group && group[1]) {
            amount = Number.parseInt(group[1])
          }
        }

        result = await commands.gacha(username, amount)

        if (isError(result)) {
          if (result.error == 'not_enough_coin') {
            await botSay(client, channel, `@${username} มี ArmCoin ไม่พอ!.`)
          }
          return
        }

        if (result.data.state == 'win_jackpot') {
          await botSay(
            client,
            channel,
            `JACKPOT!! @${username} ลงทุน ${result.data.bet} -> ได้รางวัล ${result.data.win} ArmCoin (${result.data.balance}).`,
          )

          widget.feed(
            `<b class="badge bg-primary">${username}</b> <i class="fas fa-coins"></i> JACKPOT!!! <i class="fas fa-level-up-alt"></i> +${result.data.win} ArmCoin (${result.data.balance})`,
          )
        } else if (result.data.state == 'win') {
          await botSay(
            client,
            channel,
            `@${username} ลงทุน ${result.data.bet} -> ได้รางวัล ${result.data.win} ArmCoin (${result.data.balance}).`,
          )

          widget.feed(
            `<b class="badge bg-primary">${username}</b> <i class="fas fa-hand-holding-usd"></i> <i class="fas fa-level-up-alt"></i> +${result.data.win} ArmCoin (${result.data.balance})`,
          )
        } else if (result.data.state == 'lose') {
          await botSay(
            client,
            channel,
            `@${username} ลงทุน ${result.data.bet} -> แตก! (${result.data.balance}).`,
          )

          widget.feed(
            `<b class="badge bg-danger">${username}</b> <i class="fas fa-user-injured"></i> <i class="fas fa-level-down-alt"></i> -${result.data.bet} ArmCoin (${result.data.balance})`,
          )
        }

        break
      case '!give':
        if (cmdArgs) {
          let group = cmdArgs.join(' ').match(/(\S+)\s(\d+)?/)
          if (group && group[1] && group[2]) {
            amount = Number.parseInt(group[2])

            result = await commands.giveCoin(group[1], amount)

            if (!isError(result)) {
              await botSay(
                client,
                channel,
                `@${username} เสกเงินให้ ${group[1]} จำนวน ${amount} (${result.data}).`,
              )
            }
          }
        }
        break
      case '!income':
        console.log('TODO')
        break
      case '!kick':
        console.log('TODO')
        break
      case '!market':
        const marketState = cmdArgs[0]
        if (marketState == 'open') {
          await setting.setMarketState(marketState)
          widget.feed(
            `<i class="fas fa-shopping-bag"></i> ตลาดเปิดแล้ว ไอ้พวกเวร`,
          )
        } else if (marketState == 'close') {
          await setting.setMarketState(marketState)
          widget.feed(`<i class="fas fa-stop-circle"> ปิดตลาด!</i>`)
        }

        break
      case '!payday':
        let player = await Player.withUsername(username)
        if (player.info.is_admin) {
          await payday(1, username)
        }
        break
      case '!payout': // placeholder for subscription event
        if (devMode) {
          const { playersPaidCount } = await subscriptionPayout(username)

          botSay(
            client,
            channel,
            `${username} ได้รับ 10 ArmCoin จากการ subscribe และสมาชิก ${playersPaidCount} รายได้รับ 1 ArmCoin.`,
          )
        }
        break
      case '!raffle':
        console.log('TODO')
        break
      case '!reset':
        console.log('TODO')
        break
      case '!sentry':
        console.log('TODO')
        break
      case '!thanos':
        console.log('TODO')
        break
      case '!time':
        console.log('TODO')
        break
      default:
        break
    }
  })
}
