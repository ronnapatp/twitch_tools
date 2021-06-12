import Discord, { Message } from 'discord.js'
import commands, { isError } from './bot'
import { devMode } from '../config'
import Widget from './widget'

const widget = new Widget(false)

const silentBotMode = ['1', 'true'].includes(
  process.env.SILENT_BOT_MODE as string,
)

const helpers = {
  buildEmbedMessage: (
    messages: { name: string; value: string }[],
  ): Discord.MessageEmbed => {
    const messageEmbed = new Discord.MessageEmbed().setFooter(
      'Contribute @ github: https://github.com/thananon/twitch_tools',
    )

    messages.forEach((message) => {
      messageEmbed.addField(message.name, message.value)
    })

    return messageEmbed
  },
}

type SendMessageParams = Parameters<Message['channel']['send']>

async function botSay(
  channel: Message['channel'],
  content: SendMessageParams[0],
  options?: SendMessageParams[1],
) {
  if (silentBotMode) {
    console.log(`[Silent Mode] Bot: ${JSON.stringify(content)}`)
  } else if (options) {
    return await channel.send.apply(channel, [content, options])
  } else {
    return await channel.send.apply(channel, [content])
  }
}

export async function discordService() {
  const client = new Discord.Client()

  client.on('ready', () => {
    console.log('Logged into Discord as ' + client.user!.tag)
  })

  await client.login(process.env.BOTV2_DISCORD_OAUTH_TOKEN)

  client.on('message', async (msg) => {
    if (msg.author.bot) return

    // ! Commands
    switch (msg.content.split(/\s+/)[0]) {
      case '!github':
        await botSay(msg.channel, 'https://github.com/thananon/twitch_tools')
        break

      case '!coin':
        const group = msg.content.match(/!coin\s+([a-zA-Z0-9_]*)/)
        if (group && group[1]) {
          const username = group[1].toLowerCase()
          const result = await commands.coin(username)

          if (isError(result)) {
            await botSay(
              msg.channel,
              `ไม่พบ username <${group[1]}> โปรดใส่ Twitch username..`,
            )
            return
          }

          let embed = helpers.buildEmbedMessage([
            {
              name: `<${username}>`,
              value: `มียอดคงเหลือ ${result.data} ArmCoin`,
            },
          ])

          await botSay(msg.channel, embed)
          return
        }

        await botSay(
          msg.channel,
          'ใส่ username ของ twitch สิวะ ไม่บอกแล้วจะไปรู้ได้ไงว่า id twitch เอ็งคืออะไร คิดดิคิด...',
        )

        break

      case '!leader':
        console.log('TODO')
        break
      case '!command':
        console.log('TODO')
        break
      case '!testwidget':
        if (devMode) {
          await widget.testWidget()
        }
        break
      default:
        break
    }
  })
}
