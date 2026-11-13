/**
 * Small gazetteer of common Filipino given names and surnames, used only as supporting evidence that a
 * short capitalised line is a person's name (so "Manila Paper" or "Masking Tape" in a materials list is not).
 * It is deliberately small: real class lists are caught by their shape (many lines, "Surname, Given"
 * order, middle initials, M/F markers) and by the teacher's own roster when the server has it.
 */
const GIVEN = `
juan jose maria ana anna mark john james michael angelo angel christian joshua daniel gabriel miguel rafael
carlo carlos paolo paulo jerome jericho kenneth kevin ryan bryan justin jayson jason jomar renz rhea princess
mary grace joy kristine christine nicole angelica andrea bea camille danica ella erica hannah jasmine jessa
joanna kate katrina kyla lea leah lovely mae marie mika nina patricia pia rose sofia sophia trisha vanessa
ysabel isabel lyka aira althea arnel benjie ben carla cris dennis edgar elena emmanuel francis gerald gilbert
jenny jerry jhon joel jun lorna luis manuel marco mario nathan noel paul pedro ramon ricardo roberto rodel
romeo ronald rosa ruben samuel teresa tomas vincent wilson antonio emilio josefa cristina jessica jennifer
michelle charmaine shiela sheila marilou marites rowena analyn mylene jocelyn rachelle ronnie rolando
reynaldo eduardo fernando alfredo arturo cesar danilo efren ernesto felipe gregorio leonardo lito nestor
rey rodrigo rogelio virgilio aj jm jc kc ralph renzo aldrin alvin dexter ivan jhay joms prince king
`;

const FAMILY = `
santos reyes cruz bautista ocampo garcia mendoza torres tomas andrada castillo flores villanueva ramos castro
rivera aquino navarro salazar mercado gonzales lopez hernandez perez gomez diaz fernandez martinez rodriguez
sanchez ramirez rosario leon guzman pascual domingo soriano aguilar valdez romero morales jimenez gutierrez
javier santiago manalo mallari dizon sison robles lim tan sy ong chua yap cabrera velasco panganiban lacson
macaraeg manalastas magbanua dimaculangan bernardo francisco vergara alvarez agustin bello buenaventura
cortez estrada evangelista fajardo fuentes galang ignacio lagman legaspi lorenzo lucero marquez medina
miranda natividad padilla pangilinan quiambao rosales salvador samson serrano tolentino valencia vasquez
villareal yambao zamora abad abella acosta alcantara almario angeles aragon arellano atienza baltazar
barrientos calderon carpio carino concepcion corpuz cuevas dumlao enriquez espiritu esguerra gatchalian
guevarra ilagan lacsamana macapagal mangubat nepomuceno oliva ortega pacheco pineda quimpo quintos
sarmiento sevilla tagle umali valenzuela villegas yulo zabala alonzo bacani cabanero cabahug catacutan
dagohoy delos dimaano ebarle gabriel jamero labrador lumbao mabini malong nacorda ocon pacquiao quijano
racho sabado tabada tumulak uy villamor
`;

const toSet = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

export const COMMON_GIVEN_NAMES: ReadonlySet<string> = toSet(GIVEN);
export const COMMON_FAMILY_NAMES: ReadonlySet<string> = toSet(FAMILY);

/** Lower-case particles that may sit inside a Filipino or Spanish surname ("dela Cruz", "de los Santos"). */
export const NAME_PARTICLES: ReadonlySet<string> = toSet('de dela del della delos los las la san santa sta. sto. y da di van von');
