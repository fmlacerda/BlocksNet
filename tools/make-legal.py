# Writes privacy.html and terms.html (all five languages in each page). Edit the texts here, then run:
#   python3 tools/make-legal.py . contact@example.com
# (the second argument is the contact email shown on both pages).
import html, sys
OUT = sys.argv[1]
UPDATED = {'en': 'Last updated: 27 October 2026', 'es': 'Última actualización: 27 de octubre de 2026', 'pt': 'Última atualização: 27 de outubro de 2026',
           'fr': 'Dernière mise à jour : 27 octobre 2026', 'de': 'Zuletzt aktualisiert: 27. Oktober 2026'}
BACK = {'en': '← Back to the game', 'es': '← Volver al juego', 'pt': '← Voltar ao jogo', 'fr': '← Retour au jeu', 'de': '← Zurück zum Spiel'}

PRIVACY = {
'en': ('Privacy policy', [
 ('In short', ['Rowbusters keeps as little about you as it can: no email, no real name, no ads, no tracking.']),
 ('What the game stores on its server', [
  'Your nickname, and a random code that your device makes up so your results stay yours.',
  'Your results in public rooms: wins, games, lines, pieces per minute and similar game stats, and whether you play on a phone or a computer.',
  'If you sign in with Apple, Google or Microsoft: which of them you used and a scrambled code that stands for your account. We never ask for or receive your email or name.',
  'Reports: when a player reports another one, the two random codes, the reason and the time, kept for 30 days.',
  'Chat is not stored. When someone is reported, the room’s last 20 chat lines go to the server log so the report can be checked; the log is deleted after a few days.',
  'Crash reports: the error, the game version and the browser type, without your code or nickname.']),
 ('What stays on your device', ['Your settings, nickname, language, the players you blocked and whether you accepted these rules. They never leave your device.']),
 ('Who else is involved', [
  'Cloudflare runs the game and its server, and so sees your internet address while you play.',
  'Google Fonts delivers the game’s typefaces, and so sees your internet address.',
  'Apple, Google or Microsoft, only if you choose to sign in with them.',
  'Private rooms use the PeerJS service to connect two phones directly.',
  'Nothing is sold or shared for advertising.']),
 ('Deleting your data', ['In Multiplayer, tap “Delete account” (signed in) or “Delete my results” (guest): your results, account and reports you made are deleted at once. You can also write to us.']),
 ('Children', ['Rowbusters is for everyone. It asks for no personal details, chat is filtered and players can be reported and blocked.']),
 ('Your rights and contact', ['You can ask what we hold about you, have it corrected or deleted, and complain to your data-protection authority. Contact:']),
]),
'es': ('Política de privacidad', [
 ('En resumen', ['Rowbusters guarda lo mínimo posible sobre ti: ni correo, ni nombre real, ni anuncios, ni rastreo.']),
 ('Qué guarda el juego en su servidor', [
  'Tu apodo y un código aleatorio que crea tu dispositivo para que tus resultados sigan siendo tuyos.',
  'Tus resultados en las salas públicas: victorias, partidas, filas, piezas por minuto y estadísticas similares, y si juegas en un teléfono o una computadora.',
  'Si inicias sesión con Apple, Google o Microsoft: cuál usaste y un código cifrado que representa tu cuenta. Nunca pedimos ni recibimos tu correo ni tu nombre.',
  'Denuncias: cuando un jugador denuncia a otro, los dos códigos aleatorios, el motivo y la hora, durante 30 días.',
  'El chat no se guarda. Cuando se denuncia a alguien, las últimas 20 líneas del chat de la sala van al registro del servidor para revisar la denuncia; el registro se borra a los pocos días.',
  'Informes de errores: el error, la versión del juego y el tipo de navegador, sin tu código ni tu apodo.']),
 ('Qué queda en tu dispositivo', ['Tus ajustes, apodo, idioma, los jugadores que bloqueaste y si aceptaste estas reglas. Nunca salen de tu dispositivo.']),
 ('Quién más participa', [
  'Cloudflare ejecuta el juego y su servidor, y por eso ve tu dirección de internet mientras juegas.',
  'Google Fonts entrega las tipografías del juego, y por eso ve tu dirección de internet.',
  'Apple, Google o Microsoft, solo si eliges iniciar sesión con ellos.',
  'Las salas privadas usan el servicio PeerJS para conectar dos teléfonos directamente.',
  'Nada se vende ni se comparte con fines publicitarios.']),
 ('Eliminar tus datos', ['En Multijugador, toca «Eliminar cuenta» (con sesión iniciada) o «Eliminar mis resultados» (invitado): tus resultados, tu cuenta y las denuncias que hiciste se borran al instante. También puedes escribirnos.']),
 ('Niños', ['Rowbusters es para todos. No pide datos personales, el chat está filtrado y se puede denunciar y bloquear a los jugadores.']),
 ('Tus derechos y contacto', ['Puedes pedir qué datos tenemos sobre ti, corregirlos o borrarlos, y reclamar ante tu autoridad de protección de datos. Contacto:']),
]),
'pt': ('Política de privacidade', [
 ('Em resumo', ['O Rowbusters guarda o mínimo possível sobre você: sem e-mail, sem nome real, sem anúncios, sem rastreamento.']),
 ('O que o jogo guarda no servidor', [
  'Seu apelido e um código aleatório que seu dispositivo cria para que seus resultados continuem sendo seus.',
  'Seus resultados nas salas públicas: vitórias, partidas, linhas, peças por minuto e estatísticas parecidas, e se você joga no celular ou no computador.',
  'Se você entrar com Apple, Google ou Microsoft: qual deles usou e um código embaralhado que representa sua conta. Nunca pedimos nem recebemos seu e-mail ou nome.',
  'Denúncias: quando um jogador denuncia outro, os dois códigos aleatórios, o motivo e o horário, guardados por 30 dias.',
  'O chat não é guardado. Quando alguém é denunciado, as últimas 20 linhas do chat da sala vão para o registro do servidor para verificar a denúncia; o registro é apagado em poucos dias.',
  'Relatórios de erro: o erro, a versão do jogo e o tipo de navegador, sem seu código nem seu apelido.']),
 ('O que fica no seu dispositivo', ['Suas configurações, apelido, idioma, os jogadores que você bloqueou e se aceitou estas regras. Nada disso sai do seu dispositivo.']),
 ('Quem mais participa', [
  'A Cloudflare roda o jogo e o servidor, por isso vê seu endereço de internet enquanto você joga.',
  'O Google Fonts entrega as fontes do jogo, por isso vê seu endereço de internet.',
  'Apple, Google ou Microsoft, só se você escolher entrar com eles.',
  'As salas privadas usam o serviço PeerJS para conectar dois celulares diretamente.',
  'Nada é vendido nem compartilhado para publicidade.']),
 ('Excluir seus dados', ['Em Multijogador, toque em “Excluir conta” (conectado) ou “Excluir meus resultados” (convidado): seus resultados, sua conta e as denúncias que você fez são apagados na hora. Você também pode nos escrever.']),
 ('Crianças', ['O Rowbusters é para todos. Não pede dados pessoais, o chat é filtrado e os jogadores podem ser denunciados e bloqueados.']),
 ('Seus direitos e contato', ['Você pode perguntar o que guardamos sobre você, pedir correção ou exclusão e reclamar à autoridade de proteção de dados. Contato:']),
]),
'fr': ('Politique de confidentialité', [
 ('En bref', ['Rowbusters garde le moins possible sur toi : pas d’e-mail, pas de vrai nom, pas de pub, pas de pistage.']),
 ('Ce que le jeu garde sur son serveur', [
  'Ton pseudo, et un code aléatoire créé par ton appareil pour que tes résultats restent les tiens.',
  'Tes résultats dans les salons publics : victoires, parties, lignes, pièces par minute et statistiques similaires, et si tu joues sur téléphone ou ordinateur.',
  'Si tu te connectes avec Apple, Google ou Microsoft : lequel tu as utilisé et un code brouillé qui représente ton compte. Nous ne demandons ni ne recevons jamais ton e-mail ni ton nom.',
  'Signalements : quand un joueur en signale un autre, les deux codes aléatoires, le motif et l’heure, gardés 30 jours.',
  'Le chat n’est pas conservé. Quand quelqu’un est signalé, les 20 dernières lignes du chat du salon vont dans le journal du serveur pour vérifier le signalement ; ce journal est effacé au bout de quelques jours.',
  'Rapports de plantage : l’erreur, la version du jeu et le type de navigateur, sans ton code ni ton pseudo.']),
 ('Ce qui reste sur ton appareil', ['Tes réglages, ton pseudo, ta langue, les joueurs que tu as bloqués et si tu as accepté ces règles. Rien de cela ne quitte ton appareil.']),
 ('Qui d’autre intervient', [
  'Cloudflare fait tourner le jeu et son serveur, et voit donc ton adresse internet pendant que tu joues.',
  'Google Fonts fournit les polices du jeu, et voit donc ton adresse internet.',
  'Apple, Google ou Microsoft, seulement si tu choisis de te connecter avec eux.',
  'Les salons privés utilisent le service PeerJS pour relier deux téléphones directement.',
  'Rien n’est vendu ni partagé à des fins publicitaires.']),
 ('Supprimer tes données', ['Dans Multijoueur, touche « Supprimer le compte » (connecté) ou « Supprimer mes résultats » (invité) : tes résultats, ton compte et tes signalements sont effacés tout de suite. Tu peux aussi nous écrire.']),
 ('Enfants', ['Rowbusters est pour tout le monde. Il ne demande aucune donnée personnelle, le chat est filtré et les joueurs peuvent être signalés et bloqués.']),
 ('Tes droits et contact', ['Tu peux demander ce que nous avons sur toi, le faire corriger ou supprimer, et te plaindre auprès de ton autorité de protection des données. Contact :']),
]),
'de': ('Datenschutzerklärung', [
 ('Kurz gesagt', ['Rowbusters speichert so wenig wie möglich über dich: keine E-Mail, kein echter Name, keine Werbung, kein Tracking.']),
 ('Was das Spiel auf seinem Server speichert', [
  'Deinen Spitznamen und einen Zufallscode, den dein Gerät erzeugt, damit deine Ergebnisse dir gehören.',
  'Deine Ergebnisse in öffentlichen Räumen: Siege, Spiele, Reihen, Teile pro Minute und ähnliche Spielwerte, und ob du auf einem Handy oder Computer spielst.',
  'Wenn du dich mit Apple, Google oder Microsoft anmeldest: welchen Dienst du genutzt hast und einen verschlüsselten Code für dein Konto. Wir fragen nie nach deiner E-Mail oder deinem Namen und erhalten sie nicht.',
  'Meldungen: Wenn ein Spieler einen anderen meldet, die beiden Zufallscodes, der Grund und die Uhrzeit, 30 Tage lang.',
  'Der Chat wird nicht gespeichert. Wird jemand gemeldet, gehen die letzten 20 Chatzeilen des Raums ins Server-Protokoll, damit die Meldung geprüft werden kann; das Protokoll wird nach wenigen Tagen gelöscht.',
  'Absturzberichte: der Fehler, die Spielversion und der Browsertyp, ohne deinen Code oder Spitznamen.']),
 ('Was auf deinem Gerät bleibt', ['Deine Einstellungen, dein Spitzname, deine Sprache, die Spieler, die du blockiert hast, und ob du diese Regeln akzeptiert hast. Nichts davon verlässt dein Gerät.']),
 ('Wer sonst beteiligt ist', [
  'Cloudflare betreibt das Spiel und seinen Server und sieht daher deine Internetadresse, während du spielst.',
  'Google Fonts liefert die Schriften des Spiels und sieht daher deine Internetadresse.',
  'Apple, Google oder Microsoft, nur wenn du dich bei ihnen anmeldest.',
  'Private Räume nutzen den Dienst PeerJS, um zwei Handys direkt zu verbinden.',
  'Nichts wird verkauft oder für Werbung weitergegeben.']),
 ('Deine Daten löschen', ['Tippe unter Mehrspieler auf „Konto löschen“ (angemeldet) oder „Meine Ergebnisse löschen“ (Gast): Deine Ergebnisse, dein Konto und deine Meldungen werden sofort gelöscht. Du kannst uns auch schreiben.']),
 ('Kinder', ['Rowbusters ist für alle. Es fragt nach keinen persönlichen Daten, der Chat wird gefiltert, und Spieler können gemeldet und blockiert werden.']),
 ('Deine Rechte und Kontakt', ['Du kannst erfragen, was wir über dich speichern, es berichtigen oder löschen lassen und dich bei deiner Datenschutzbehörde beschweren. Kontakt:']),
]),
}

TERMS = {
'en': ('Terms of use', [
 ('The game', ['Rowbusters is a free game. By playing online you agree to these terms. If you got Rowbusters from the App Store, Apple’s standard licence terms apply as well.']),
 ('How to behave', [
  'There is zero tolerance for offensive content: no insults, hate, harassment, threats, sexual content or spam, in chat or in nicknames.',
  'No cheating: don’t use modified versions of the game or tools that play for you.']),
 ('How we keep it friendly', [
  'Bad words in chat are hidden automatically, and offensive nicknames are replaced.',
  'Tap a player in a room to report them or to block them (you won’t see their chat).',
  'Players reported by several others are muted for a day, and offensive nicknames are replaced automatically.',
  'We review reports within 24 hours and may remove content, results or players who break these rules, for good.']),
 ('Accounts', ['Signing in is optional. You can delete your account and results at any time in Multiplayer.']),
 ('No guarantees', ['The game is provided as it is, and may change or be unavailable at times. As far as the law allows, we are not liable for losses from using it.']),
 ('Contact', ['Questions, problems or reports:']),
]),
'es': ('Condiciones de uso', [
 ('El juego', ['Rowbusters es un juego gratuito. Al jugar en línea aceptas estas condiciones. Si descargaste Rowbusters del App Store, también se aplican las condiciones de licencia estándar de Apple.']),
 ('Cómo comportarse', [
  'Tolerancia cero con el contenido ofensivo: nada de insultos, odio, acoso, amenazas, contenido sexual ni spam, ni en el chat ni en los apodos.',
  'Nada de trampas: no uses versiones modificadas del juego ni herramientas que jueguen por ti.']),
 ('Cómo lo mantenemos agradable', [
  'Las palabrotas del chat se ocultan automáticamente y los apodos ofensivos se reemplazan.',
  'Toca a un jugador de la sala para denunciarlo o bloquearlo (no verás su chat).',
  'Quien recibe denuncias de varios jugadores queda silenciado un día, y los apodos ofensivos se reemplazan automáticamente.',
  'Revisamos las denuncias en 24 horas y podemos eliminar contenido, resultados o jugadores que incumplan estas reglas, de forma definitiva.']),
 ('Cuentas', ['Iniciar sesión es opcional. Puedes eliminar tu cuenta y tus resultados en cualquier momento en Multijugador.']),
 ('Sin garantías', ['El juego se ofrece tal cual y puede cambiar o no estar disponible a veces. En la medida en que lo permita la ley, no respondemos por pérdidas derivadas de su uso.']),
 ('Contacto', ['Preguntas, problemas o denuncias:']),
]),
'pt': ('Termos de uso', [
 ('O jogo', ['O Rowbusters é um jogo gratuito. Ao jogar online, você concorda com estes termos. Se você baixou o Rowbusters na App Store, os termos de licença padrão da Apple também se aplicam.']),
 ('Como se comportar', [
  'Tolerância zero com conteúdo ofensivo: nada de insultos, ódio, assédio, ameaças, conteúdo sexual ou spam, no chat ou nos apelidos.',
  'Nada de trapaça: não use versões modificadas do jogo nem ferramentas que joguem por você.']),
 ('Como mantemos tudo amigável', [
  'Palavrões no chat são ocultados automaticamente, e apelidos ofensivos são trocados.',
  'Toque em um jogador da sala para denunciá-lo ou bloqueá-lo (você não verá o chat dele).',
  'Quem é denunciado por vários jogadores fica sem chat por um dia, e apelidos ofensivos são trocados automaticamente.',
  'Analisamos as denúncias em até 24 horas e podemos remover conteúdo, resultados ou jogadores que desrespeitem estas regras, de vez.']),
 ('Contas', ['Entrar com uma conta é opcional. Você pode excluir sua conta e seus resultados a qualquer momento em Multijogador.']),
 ('Sem garantias', ['O jogo é oferecido como está e pode mudar ou ficar indisponível às vezes. Na medida permitida por lei, não respondemos por perdas decorrentes do uso.']),
 ('Contato', ['Dúvidas, problemas ou denúncias:']),
]),
'fr': ('Conditions d’utilisation', [
 ('Le jeu', ['Rowbusters est un jeu gratuit. En jouant en ligne, tu acceptes ces conditions. Si tu as obtenu Rowbusters sur l’App Store, les conditions de licence standard d’Apple s’appliquent aussi.']),
 ('Comment se comporter', [
  'Tolérance zéro pour les contenus offensants : pas d’insultes, de haine, de harcèlement, de menaces, de contenu sexuel ni de spam, dans le chat comme dans les pseudos.',
  'Pas de triche : n’utilise pas de version modifiée du jeu ni d’outils qui jouent à ta place.']),
 ('Comment nous gardons une bonne ambiance', [
  'Les gros mots du chat sont masqués automatiquement, et les pseudos offensants sont remplacés.',
  'Touche un joueur du salon pour le signaler ou le bloquer (tu ne verras plus son chat).',
  'Un joueur signalé par plusieurs autres est réduit au silence pendant un jour, et les pseudos offensants sont remplacés automatiquement.',
  'Nous examinons les signalements sous 24 heures et pouvons supprimer définitivement les contenus, résultats ou joueurs qui enfreignent ces règles.']),
 ('Comptes', ['La connexion est facultative. Tu peux supprimer ton compte et tes résultats à tout moment dans Multijoueur.']),
 ('Aucune garantie', ['Le jeu est fourni tel quel et peut changer ou être indisponible par moments. Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes liées à son utilisation.']),
 ('Contact', ['Questions, problèmes ou signalements :']),
]),
'de': ('Nutzungsbedingungen', [
 ('Das Spiel', ['Rowbusters ist ein kostenloses Spiel. Wenn du online spielst, stimmst du diesen Bedingungen zu. Hast du Rowbusters aus dem App Store, gelten zusätzlich Apples Standard-Lizenzbedingungen.']),
 ('Wie man sich verhält', [
  'Null Toleranz für anstößige Inhalte: keine Beleidigungen, kein Hass, keine Belästigung, keine Drohungen, keine sexuellen Inhalte und kein Spam, weder im Chat noch in Spitznamen.',
  'Kein Schummeln: Nutze keine veränderten Versionen des Spiels und keine Programme, die für dich spielen.']),
 ('Wie wir es freundlich halten', [
  'Schimpfwörter im Chat werden automatisch ausgeblendet, anstößige Spitznamen ersetzt.',
  'Tippe auf einen Spieler im Raum, um ihn zu melden oder zu blockieren (dann siehst du seinen Chat nicht mehr).',
  'Wer von mehreren Spielern gemeldet wird, wird einen Tag stummgeschaltet, und anstößige Spitznamen werden automatisch ersetzt.',
  'Wir prüfen Meldungen innerhalb von 24 Stunden und können Inhalte, Ergebnisse oder Spieler, die gegen diese Regeln verstoßen, dauerhaft entfernen.']),
 ('Konten', ['Die Anmeldung ist freiwillig. Du kannst dein Konto und deine Ergebnisse jederzeit unter Mehrspieler löschen.']),
 ('Keine Garantie', ['Das Spiel wird so bereitgestellt, wie es ist, und kann sich ändern oder zeitweise nicht verfügbar sein. Soweit gesetzlich zulässig, haften wir nicht für Schäden aus der Nutzung.']),
 ('Kontakt', ['Fragen, Probleme oder Meldungen:']),
]),
}

def page(name, data, title_key):
    blocks = []
    for lang, (title, sections) in data.items():
        secs = []
        for h, paras in sections:
            body = ''.join(f'<li>{html.escape(p)}</li>' for p in paras) if len(paras) > 1 else f'<p>{html.escape(paras[0])}</p>'
            if len(paras) > 1: body = f'<ul>{body}</ul>'
            secs.append(f'<h2>{html.escape(h)}</h2>{body}')
        blocks.append(f'''<article lang="{lang}" hidden>
    <h1>{html.escape(title)}</h1><p class="upd">{UPDATED[lang]}</p>
    {''.join(secs)}
    <p><a class="contact" href="#"></a></p>
    <p><a href="./">{BACK[lang]}</a></p>
  </article>''')
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rowbusters · {data['en'][0]}</title>
<meta name="color-scheme" content="dark">
<!-- Generated in all five languages; the page shows the player's language (as chosen in the game). -->
<style>
  body {{ margin: 0; background: #160B2E; color: #F5F0FF; font: 16px/1.55 "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif; }}
  main {{ max-width: 680px; margin: 0 auto; padding: 24px 16px 48px; }}
  h1 {{ font-size: 26px; margin: 0 0 4px; }} h2 {{ font-size: 18px; margin: 26px 0 6px; color: #C6FF3D; }}
  .upd {{ color: #A99BCB; font-size: 14px; margin: 0 0 18px; }} ul {{ padding-left: 20px; }} li {{ margin: 6px 0; }}
  a {{ color: #C6FF3D; }} nav {{ display: flex; gap: 10px; flex-wrap: wrap; font-size: 14px; margin-bottom: 18px; }} nav a {{ color: #C4B8E3; }}
</style>
</head>
<body data-contact="{CONTACT}">
<main>
  <nav>{''.join(f'<a href="?lang={l}">{n}</a>' for l, n in [('en','English'),('es','Español'),('pt','Português'),('fr','Français'),('de','Deutsch')])}</nav>
  {''.join(blocks)}
</main>
<script>
  // Same language as the game: ?lang=, then the one chosen in the game, then the browser's.
  (function () {{
    var langs = ['en', 'es', 'pt', 'fr', 'de'], want = [new URLSearchParams(location.search).get('lang')];
    try {{ want.push(JSON.parse(localStorage.getItem('rb.lang') || 'null')); }} catch (e) {{}}
    want = want.concat(navigator.languages || [navigator.language]);
    var lang = 'en';
    for (var i = 0; i < want.length; i++) {{ var c = String(want[i] || '').slice(0, 2).toLowerCase(); if (langs.indexOf(c) >= 0) {{ lang = c; break; }} }}
    document.documentElement.lang = lang;
    var a = document.querySelector('article[lang="' + lang + '"]');
    a.hidden = false;
    document.title = 'Rowbusters · ' + a.querySelector('h1').textContent;
    var mail = document.body.dataset.contact;
    document.querySelectorAll('.contact').forEach(function (el) {{ if (mail) {{ el.textContent = mail; el.href = 'mailto:' + mail; }} else el.parentNode.hidden = true; }});
  }})();
</script>
</body>
</html>
'''
CONTACT = sys.argv[2]
open(f'{OUT}/privacy.html', 'w').write(page('privacy', PRIVACY, 'privacy'))
open(f'{OUT}/terms.html', 'w').write(page('terms', TERMS, 'terms'))
print('written')
