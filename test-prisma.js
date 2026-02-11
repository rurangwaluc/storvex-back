const { PrismaClient } = require('@prisma/client')

console.log(require.resolve('@prisma/client'))

const prisma = new PrismaClient({})

async function main() {
  await prisma.$connect()
  console.log('Connected OK')
}

main()
