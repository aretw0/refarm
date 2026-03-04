import fs from 'fs';
import { run } from 'npm-check-updates';

async function main() {
  const isUpdate = process.argv.includes('--update');
  const reportPath = 'deps-report.md';
  console.log(`🔍 Buscando dependências desatualizadas nos workspaces... (update=${isUpdate})`);

  try {
    const upgraded = await run({
      workspaces: true,
      root: true,
      upgrade: isUpdate,
    });

    let reportContent = '# 🔄 Relatório de Atualização de Dependências\n\n';

    if (!upgraded || Object.keys(upgraded).length === 0) {
      reportContent += '✅ **Nenhuma dependência desatualizada!** Tudo está na versão mais recente.\n';
      fs.writeFileSync(reportPath, reportContent);
      console.log('✅ Tudo atualizado. Relatório gerado.');
      return;
    }

    reportContent += 'As seguintes dependências possuem versões mais recentes disponíveis:\n\n';

    let hasUpdates = false;

    // Output struct: { "package.json": { "pkg": "ver" }, ... }
    for (const [file, packages] of Object.entries(upgraded)) {
      if (packages && Object.keys(packages).length > 0) {
        hasUpdates = true;
        reportContent += `### 📁 \`${file}\`\n\n`;
        reportContent += '| Pacote | Nova Versão |\n';
        reportContent += '|--------|-------------|\n';
        for (const [pkg, version] of Object.entries(packages)) {
          reportContent += `| \`${pkg}\` | \`${version}\` |\n`;
        }
        reportContent += '\n';
      }
    }

    if (!hasUpdates) {
      reportContent += '✅ **Nenhuma dependência desatualizada!**\n';
    }
    
    reportContent += '\n---\n';
    reportContent += '> 🤖 **Nota:** Relatório gerado automaticamente por `npm run deps:check`.\n';
    
    if (isUpdate) {
      reportContent += '> ⚠️ **Ação Executada:** Os arquivos `package.json` foram modificados com as novas versões. As mudanças estão prontas para o PR.\n';
    } else {
      reportContent += '> 💡 Execute `npm run deps:update` para aplicar as atualizações localmente se preferir antes de criar o PR.\n';
    }

    fs.writeFileSync(reportPath, reportContent);
    console.log(`✅ Relatório gravado em ${reportPath}`);

  } catch (err) {
    console.error('❌ Falha ao verificar dependências:', err);
    process.exit(1);
  }
}

main().catch(console.error);
