import type { UserOrganization } from "@shared/proto/cline/account"
import { ClineAccountView } from "@/components/account/AccountView"
import { AccountWelcomeView } from "@/components/account/AccountWelcomeView"
import { UnlokAccountView } from "@/components/account/UnlokAccountView"
import type { ClineUser } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"

interface AccountSectionProps {
	clineUser: ClineUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const AccountSection = ({ clineUser, organizations, activeOrganization, renderSectionHeader }: AccountSectionProps) => {
	const { environment, apiConfiguration } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("account")}
			<Section>
				{apiConfiguration?.unlokApiKey ? (
					<UnlokAccountView />
				) : clineUser?.uid ? (
					<ClineAccountView
						activeOrganization={activeOrganization}
						clineEnv={environment === "local" ? "Local" : environment === "staging" ? "Staging" : "Production"}
						clineUser={clineUser}
						key={clineUser.uid}
						userOrganizations={organizations}
					/>
				) : (
					<AccountWelcomeView />
				)}
			</Section>
		</div>
	)
}

export default AccountSection
